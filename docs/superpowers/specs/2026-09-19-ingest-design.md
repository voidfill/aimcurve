# KovaaK's Ingest Design

How `Stats.csv` and `.perf` files get from a player's disk into the run schema —
file discovery, deduplication, the thread split, and the batch that writes them.

Prerequisites: [`ingest.md`](../../ingest.md) (what a run *is*, how CSV and `.perf`
pair, which files are lies) and
[`2026-09-18-run-schema-design.md`](2026-09-18-run-schema-design.md) (the tables
this writes into, which lists ingest as out of scope — this is that follow-on).

Out of scope here: the UI that drives ingest, any retention policy, and the
query/client API. Numbers quoted without a citation come from `ingest.md`'s
measurements over the full dump.

## Summary of decisions

| | |
| --- | --- |
| D1 | One core, three sources; the input type is `File` |
| D2 | Dedupe is a database query, by filename stem, before anything is opened |
| D3 | The main thread orchestrates; the worker is a pure function |
| D4 | Set logic lives in SQL, behind staging tables |
| D5 | Stage per-record rows; the array columns are built by `array_agg` |
| D6 | One transaction per chunk, committed progressively |
| D7 | Ambiguous and orphan perfs are assertions, not filters |
| D8 | A failed chunk is re-run file-by-file to name the offender |
| D9 | `FileSystemObserver` is a trigger, not a data source |
| D10 | Watch mode cannot resume without a user gesture |
| D11 | Classification is a pure function of one file |

---

### D1. One core, three sources; the input type is `File`

There is one ingester. What varies is where the files come from, and that
variation is confined to a two-method interface:

```ts
export interface SourceEntry {
	name: string;                    // "Air Pure Medium - Challenge - ….csv"
	open(): Promise<File>;
}

export interface FileSource {
	/** Every file present now, names only. Never opens anything. */
	list(): Promise<SourceEntry[]>;
	/** Fires when the folder changes. Absent if the source cannot watch. */
	watch?(onChange: () => void): () => void;
}
```

| impl | `list()` | `open()` | `watch()` |
| --- | --- | --- | --- |
| `source-bulk.ts` | over the `FileList` from `<input webkitdirectory>` | returns the `File` it already holds | — |
| `source-handle.ts` | recursive walk of a persisted `FileSystemDirectoryHandle` | `handle.getFile()` | ✅ |
| `source-node.ts` | `readdir` | `openAsBlob` wrapped as a `File` | — |

`File` is the input type because every source can produce one and because it is
structured-cloneable, so it crosses into the worker without a copy of the bytes.
`File` is also a Node >= 20 global and `fs.openAsBlob` returns a real `Blob`, which
makes the Node source about fifteen lines. **The Node source is test plumbing and
does not ship** — no CLI, no Node entry point. It exists so the full corpus can be
driven through the real ingester under vitest.

Watch mode is bulk mode plus a handle store and a trigger. It is not a second
ingester; see D9.

#### Matching by suffix, not by directory

The source recurses from one picked root and selects on `… Stats.csv` and
`… Performance.perf`. It does not assume a directory layout.

`ingest.md` refers to "both output directories", and the fixtures keep `stats/`
and `performances/` as siblings, but the layout of a real install is not pinned by
anything in this repo. Recursing from a single root means the user picks once, the
fixture layout works unmodified, and a KovaaK's update that relocates a folder does
not break ingest. Everything that is not one of the two suffixes is ignored.

### D2. Dedupe is a database query, by filename stem, before anything is opened

`ingest.md` establishes that the filename stem is the only zero-collision
identifier (2468 distinct in 2468 files; `(Hash, shots, hits)` collides 75 times).
The schema already stores it, uniquely, in all three places a CSV can land:
`run.file_stem`, `unattributed_file.file_stem`, and — separately, because a CSV and
its perf can be named a second apart — `run_perf.perf_file_stem`.

So dedupe needs no side store and no manifest:

```sql
select file_stem from run
union all
select file_stem from unattributed_file;
```

One query, one `Set<string>`, diffed against `list()` **by name**. Listing 5,000
names costs microseconds; the win is never opening the thousands already seen.
Perfs diff against `run_perf.perf_file_stem` in the same way.

Two properties fall out of putting the dedupe set in the database rather than
beside it:

- **A migrator reset cannot desynchronise it.** `getLastMigration().reset` tells
  the caller its data is gone, but ingest does not need to be told: the stem set
  comes back empty and the next pass re-reads everything.
- **Progress is resumable for free.** Chunks commit as they go (D6), so closing
  the tab at file 1,800 resumes at 1,800.

Files that fail to parse are deliberately **not** recorded, so they are not in the
dedupe set and are retried on every pass. That is the desired behaviour: a later
parser fix picks them up with no cache to clear, and the retry cost is bounded by
how rare they are. See D8.

### D3. The main thread orchestrates; the worker is a pure function

PGlite already runs in its own worker (run-schema D11). Parsing is the other CPU
cost, and it must not land on the UI thread.

```
main thread                          ingest worker
───────────                          ─────────────
list() directory names        ────
query known stems             ────
diff -> work list, sorted     ────
  for each chunk of ~200:
    File[]  ──────────────────────▶  parse CSVs, decode + pivot perfs
                                     classify, build COPY payloads
            ◀──────────────────────  { payloads, failures }   (transferred)
    COPY into stage_*
    run the batch SQL
    <- run_ingested notify -> UI
```

The worker never touches the database and does not know one exists. It is a pure
function from `File[]` to bytes, which means tests import it directly with no
`Worker` and no PGlite in the path.

The rejected alternatives are worth recording, because "put ingest in the database
worker" is the first idea everyone has:

- **Ingest inside the PGlite worker.** `pglite/worker`'s `worker({ init })` helper
  owns the worker's message channel and exposes no custom-RPC hook, so this means
  hand-rolling the worker protocol. It also puts file I/O and parsing on the same
  thread as every UI query, blocking reads that had no need to block.
- **An ingest worker holding its own `PGliteWorker` client.** Legitimate — PGlite
  elects a leader over web locks precisely so multiple clients can attach — but it
  needs a nested `new Worker`, adds a second leader candidate, and routes payloads
  over `BroadcastChannel`, which takes **no transfer list** and therefore deep-copies
  every COPY payload. Direct, and slower than not being direct.
- **Worker-initiated RPC back through the main thread.** Works, and costs nothing
  (payloads are `Uint8Array` and transfer on both hops; traffic is per *chunk*, not
  per file), but inverting the arrow removes the plumbing entirely.

The main thread holds the `File` objects and awaits `getFile()`, which is async I/O,
not compute. Its only CPU work is `postMessage` bookkeeping.

### D4. Set logic lives in SQL, behind staging tables

The worker emits flat rows. They are `COPY`d into unlogged `stage_*` tables, and one
SQL script does the rest: intern the dimensions, insert the runs, join the perfs,
build the arrays, roll up the per-bot totals.

This is not a stylistic preference. Three specific things get better:

- **The CSV/perf join becomes the index's intended query.** The run schema's comment
  on `no_overlapping_runs` says the GiST index behind it "also serves that join, but
  only through overlap against a one-second probe range". Writing the join in SQL is
  writing exactly that; writing it in TypeScript is reimplementing range containment
  next to a database that already indexes it.
- **Interning is `insert … on conflict do nothing`**, with no round trip per
  dimension batch and no in-memory map to invalidate.
- **`run_bot` cannot drift from `kill_series`**, because both are derived from the
  same staged rows in the same transaction (D5).

Round trips per chunk: one COPY per stage table, one script. Not per file.

#### `0006_stage.sql`

| table | grain | natural keys it carries instead of ids |
| --- | --- | --- |
| `stage_run` | one CSV | `file_stem`, `scenario_hash`, `scenario_name`, `version_label`, the 15 `config` columns inline |
| `stage_kill` | one kill row | `file_stem`, `idx`, `bot_name`, `weapon_name` |
| `stage_weapon` | one weapon row | `file_stem`, `weapon_name` |
| `stage_perf` | one `.perf` header | `perf_file_stem`, `challenge_start_utc`, the three bot arrays as **jsonb** |
| `stage_tick` | one tick | `perf_file_stem`, `t`, the 13 nullable metrics |
| `stage_unattributed` | one abort | `file_stem`, `written_at`, `payload` |

Unlogged: they are truncated at the end of every batch and nothing reads them
across a session, so WAL for them is pure cost.

`run_perf`'s three array columns (`added_bots`, `bot_max_lives`, `bot_teams`) stage
as `jsonb` and are unpacked in SQL. Not for elegance: `JSON.stringify` is correct by
construction, and a hand-rolled Postgres array literal containing bot names is a
quoting bug waiting to happen. Every other staged column is scalar.

### D5. Stage per-record rows; the array columns are built by `array_agg`

The obvious staging design mirrors the targets, arrays and all. It is the wrong one:
it forces the worker to emit array literals with per-element escaping, and it throws
away the aggregation SQL is built for.

Staging one row per kill makes both array-backed targets fall out of the same scan:

```sql
insert into kill_series (run_id, at_ms, bot_id, weapon_id, ttk, shots, hits,
                         damage_done, damage_possible, overshots, cheated)
select run_id,
       array_agg(at_ms     order by idx), array_agg(bot_id    order by idx),
       array_agg(weapon_id order by idx), array_agg(ttk       order by idx),
       array_agg(shots     order by idx), array_agg(hits      order by idx),
       array_agg(damage_done     order by idx),
       array_agg(damage_possible order by idx),
       array_agg(overshots order by idx), array_agg(cheated   order by idx)
from staged_kills group by run_id;

insert into run_bot (run_id, bot_id, kills, avg_ttk, shots, hits,
                     damage_done, damage_possible, overshots)
select run_id, bot_id, count(*), avg(ttk), sum(shots), sum(hits),
       sum(damage_done), sum(damage_possible), sum(overshots)
from staged_kills group by run_id, bot_id;
```

`staged_kills` is a CTE shared by both statements: `stage_kill` joined to `run` on
`file_stem` and to `bot`/`weapon` on name, which is where the natural keys become
ids. Nothing else in the batch needs those rows.

`run_bot` is *defined* as a per-bot rollup of the kill table, so deriving it here
rather than in TypeScript removes the only place the two could disagree. The same
shape produces `run_series` from `stage_tick`.

Volume is not a concern: 75,504 kill rows and roughly 133,000 tick rows across the
whole corpus, which is what the run-schema spec already measured COPY against.

The `array_agg(… order by idx)` ordering is load-bearing — the alignment `CHECK`
catches a length mismatch but not a permutation — so it is asserted by a curated
test that reads a known run back through the `kill` view and compares to the file.

### D6. One transaction per chunk, committed progressively

A chunk is ~200 CSVs. Per chunk, in one transaction:

1. **Intern.** `insert into scenario (hash, name) select distinct … from stage_run
   on conflict do nothing`; likewise `game_version`, `config` (which has a natural
   `unique` over all 15 columns), and `bot`/`weapon` from `stage_kill`.
   Names are `btrim`ed **in the parser**, never here: `bot_name_trimmed` exists to
   catch an ingester that forgot, and laundering the value in the ingest SQL would
   disarm it.
2. **`run`**, joining staging to the dimensions, `on conflict (file_stem) do nothing`.
   The conflict clause is what makes re-ingest a no-op and a two-tab race harmless.
3. **`unattributed_file`** for aborts, same conflict clause.
4. **`run_weapon`**, then `kill_series` and `run_bot` from the grouped staging (D5).
5. **The perf join**, one statement:

```sql
insert into run_perf (run_id, perf_file_stem, challenge_start_utc, schema_version, …)
select r.id, p.perf_file_stem, p.challenge_start_utc, p.schema_version, …
from stage_perf p
join run r on r.kind = 'complete'
          and r.span && tstzrange(p.challenge_start_utc,
                                  p.challenge_start_utc + interval '1 second')
on conflict (perf_file_stem) do nothing;
```

   The one-second probe is the 1000 ms of lower-bound slack `ingest.md` specifies,
   written as an overlap because `span @> challenge_start_utc` matches nothing: the
   perf's start is truncated to the second and so is almost always *earlier* than
   `started_at`.

6. **`run_series`** from `stage_tick`, joined through `run_perf`.
7. `truncate` the stage tables.

Chunks commit as they complete. Combined with D2 this makes the import resumable at
no cost, and it gives the UI a progress signal for free: the statement-level
`run_ingested` trigger fires once per chunk, carrying `{count, max_id}`.

**Work is sorted by filename timestamp** before chunking, so a CSV and its perf —
written 1.6 ms apart — land in the same chunk except at a boundary. D7 covers the
boundary.

### D7. Ambiguous and orphan perfs are assertions, not filters

`ingest.md` is explicit that a perf without a CSV means something upstream is
broken and must be reported rather than silently dropped. Both checks run in SQL
over the staged batch.

**Ambiguous** — a perf whose probe matched more than one run. This is unique *by
construction*, not by luck: `written_at` is the end of the write second, and the
probe's lower bound is an exact second boundary, so a second match would require two
`complete` spans to overlap, which `no_overlapping_runs` forbids. It is still checked
with `having count(*) <> 1`, because that argument is precisely the kind that stops
being true after a schema change and fails silently when it does.

**Orphan** — a perf whose probe matched nothing. In bulk this is the assertion
`ingest.md` describes. In watch mode it is **normal and transient**: the CSV is
written ~1.6 ms before the perf, so a perf routinely arrives in a batch whose CSV has
not been read yet. Conflating the two would make live mode cry wolf on every run.

So: unmatched perfs are collected across the pass, re-staged **once** at the end of
it, and only what survives that is reported. Nothing is persisted for retry — an
unmatched perf is not in `run_perf`, so the next pass re-reads it from disk anyway.

Neither check aborts the import. Both land in the report (D8).

### D8. A failed chunk is re-run file-by-file to name the offender

A chunk is one transaction, so one bad row takes 200 files with it. On a chunk
failure the ingester re-runs that chunk one file at a time, records the offender and
its error in the report, and continues with the next chunk.

This costs nothing in the normal case — it only runs after a failure — and it is the
only way a constraint violation surfaces as "this file, this constraint" instead of
"your import failed". The realistic trigger is a misclassified reset colliding with
`no_overlapping_runs`, which is exactly the diagnosis worth having.

Parser throws are handled at the same granularity but earlier: the worker catches per
file, emits the rest of the chunk, and returns the failure alongside the payloads.

```ts
export interface IngestReport {
	scanned: number;          // names seen in list()
	skipped: number;          // already in the dedupe set
	runs: number;             // rows inserted into run
	aborts: number;           // rows inserted into unattributed_file
	perfsMatched: number;
	failures: { name: string; error: string }[];
	orphanPerfs: string[];    // survived the end-of-pass retry
	ambiguousPerfs: string[];
}
```

Failures are reported, never stored. A parser fix therefore picks them up on the next
pass with nothing to clear (D2).

### D9. `FileSystemObserver` is a trigger, not a data source

`FileSystemObserver` can deliver `unknown` records — coalesced changes carrying no
usable path — so any correct handler must be able to fall back to "something changed,
rescan". Given that, the records are not read at all:

```
observer fires  ─┐
                 ├─▶ debounce 250 ms ─▶ list() ─▶ diff ─▶ ingest new
setInterval(10s)─┘
```

Both triggers run the same rescan, which is the same code path as a cold start and
as a bulk import. Three consequences:

- **"observer vs polling" is a feature detection, not an architecture.**
  `FileSystemObserver` is Chromium-only and recent; where it is missing, an interval
  fires the identical rescan.
- **"ingest everything on start, not just the first time" is satisfied by
  construction** — starting *is* a rescan.
- `ingest.md` establishes that files are written once, atomically, and that a file
  which exists is finished. There is no size-stability polling and no settle delay.
  The 250 ms debounce exists to coalesce a burst, not to wait for a write.

A **disappeared file never deletes a run.** Players prune their stats folder and the
history is the product.

### D10. Watch mode cannot resume without a user gesture

The directory handle structured-clones into IndexedDB — its own small store, keyed
once, separate from PGlite's `idb://aimcurve`.

On reload, `handle.queryPermission({ mode: 'read' })` returns `granted` or `prompt`.
When it returns `prompt`, `requestPermission()` **requires a user gesture**, so watch
mode cannot silently resume on page load; the UI needs a reconnect affordance. This
is a constraint on the feature, not an implementation detail.

It is also why bulk stays first-class rather than being a fallback tier. The wider
reason is the platform:

| | pick a real directory | persist across reload | live |
| --- | --- | --- | --- |
| Chromium, allowed path | ✅ `showDirectoryPicker` | ✅ handle in IndexedDB | ✅ |
| Chromium, blocked path | ❌ | — | — |
| Firefox / Safari | ❌ | — | — |
| everyone | `<input webkitdirectory>` | ❌ | ❌ |

The File System Access API (`showDirectoryPicker`, handle persistence) is a WICG
proposal implemented only in Chromium; Firefox and Safari ship the WHATWG File System
standard, which is the *origin-private* file system and cannot see a game directory.
And Chromium's picker blocklist is path-based, so a default Steam install under
`C:\Program Files (x86)\Steam\…` cannot be picked at all, while the common
secondary-drive library can. Watch mode therefore serves "Chromium users who moved
their Steam library" — a real group, but not the default one.

### D11. Classification is a pure function of one file

`kind` is decided by `ingest.md`'s documented rules, in `classify.ts`, from the
filename and the parsed key/value block alone:

```
abort  <=>  Scenario: or Hash: is empty
reset  <=>  duration < 1s, where duration = (filename timestamp, end of second) - Challenge Start
```

Never from `Avg FPS`: `ingest.md` records that a reset's `Avg FPS` is uninitialised
memory, observed at 7.3e9 and 8.9e9, and that testing `== 0` misclassifies 3 of 22
resets as completed runs.

Aborts route to `unattributed_file` with the whole parsed document as `payload`, not
just the key/value block — the one abort in the corpus has an empty kill table but a
real weapon row with 1306 shots.

Midnight rollover is handled where the date is attached: `Challenge Start` has no
date, so a start that lands more than a minute *after* the write time is pushed back
a day. No fixture exercises it; `ingest.md` lists it as an open gap and this design
does not close it, only confines it here.

Being a pure function of one file, this is unit-tested directly against the committed
curated fixtures, which include the reset, the abort, and the off-by-one pair.

---

## Module map

```
src/lib/parse/perf.ts        NEW — decode a .perf and pivot its events to ticks.
                                   Does not exist yet: perf.test.ts calls fromBinary
                                   inline. Prerequisite for everything below.
src/lib/ingest/
  source.ts                  FileSource, SourceEntry
  source-bulk.ts             FileList         -> FileSource
  source-handle.ts           DirectoryHandle  -> FileSource (+ watch)
  source-node.ts             readdir/openAsBlob -> FileSource   (tests only)
  handle-store.ts            IndexedDB persistence + permission query
  classify.ts                filename parse, kind, interval, midnight rollover
  copy.ts                    COPY text-format writer
  worker.ts                  pure: File[] -> { payloads, failures }
  index.ts                   orchestrator (main thread)
  report.ts                  IngestReport
  batch.sql                  the batch script of D6, loaded as ?raw
src/db/sql/0006_stage.sql    the stage_* tables
```

The batch script deliberately does **not** live in `src/db/sql/`. `migrations.ts`
globs that directory eagerly and treats *every* `.sql` file in it as a migration, so
a file placed there would be applied once and recorded, which is the opposite of what
a script run on every chunk needs. Only `0006_stage.sql` — a real schema change —
belongs there.

`src/lib/parse/perf.ts` is a real prerequisite, not a rename. It owns decoding, the
event-to-tick pivot (lossless: `(timestamp, event type)` is unique across all 2164
files, 815,361 events for 815,361), and the rule that an event type outside the 13
observed makes ingest raise.

`copy.ts` writes COPY **text** format: tab-separated, `\N` for null, escaping
backslash, tab, newline and carriage return. Scenario names are user-authored and can
contain anything, so the escaper is the one piece of this that gets a round-trip test
against a real table rather than a snapshot.

## Testing

The headline test **re-derives `ingest.md`'s measurement with the real ingester**:
the Node source over `test/fixtures/raw/`, an in-memory PGlite, asserting
2154/2154 perfs matched, 0 unmatched, 0 ambiguous, 0 perf claimed twice, and 310
CSV-only runs. `corpus.test.ts` asserts the same numbers today through a test-local
reimplementation; this replaces the reimplementation with the thing that ships.
Guarded on `raw.available` and skipped on a fresh clone, like its neighbours.

Around it:

| test | what it pins |
| --- | --- |
| `classify.test.ts` | complete / reset / abort against curated fixtures; the reset off-by-one; never `Avg FPS` |
| `copy.test.ts` | escaping round-trip — write a payload, COPY it into a stage table, read back |
| `ingest.curated.test.ts` | end to end over the committed fixtures: run counts, the join, `unattributed_file` for the abort, `kill_series` order through the `kill` view |
| idempotency | second pass opens 0 files and inserts 0 rows |
| failure isolation | an injected corrupt file: the rest of its chunk commits, the report names it, the next pass retries it |
| orphan retry | a perf staged before its CSV matches on the end-of-pass retry and is not reported |

`worker.ts` is a pure function, so no test constructs a `Worker`.

## Benchmarks

`vitest bench` (tinybench) with `*.bench.ts` files and a `"bench": "vitest bench"`
script. The point is to have the harness in place and the stages separated, so a
regression can be attributed; no target numbers are set here.

`src/lib/ingest/ingest.bench.ts`, four cases along the pipeline:

| case | isolates |
| --- | --- |
| `parse csv` | `parseStatsCsv` over N files, no database |
| `parse perf` | decode + tick pivot over N files, no database |
| `build copy payloads` | the worker's whole pure path, including escaping |
| `full ingest` | one chunk into a fresh in-memory PGlite: COPY + the batch SQL |

Files are read into memory **once**, outside the measured body, so the benchmark
measures parsing and writing rather than the filesystem. `full ingest` uses
tinybench's per-iteration `setup`/`teardown` to hand each iteration a fresh
`new PGlite()` with migrations applied, and runs with a low iteration count since a
single iteration is seconds, not microseconds.

Benches run against `test/fixtures/raw/` when available and fall back to the curated
set otherwise, so `pnpm bench` does something useful on a fresh clone even though the
numbers are not comparable across the two.

## Out of scope

- The UI: the picker button, the reconnect affordance, progress display, the
  "sync again" button for browsers that cannot watch (which is a plain re-run of the
  bulk ingester, not a third source).
- A Node CLI importer. The Node source is test plumbing (D1).
- Retention of old `run_series` rows, as the run-schema spec already defers.
- A parse worker *pool*. Parsing is embarrassingly parallel and this may be worth
  revisiting, but a single worker should be measured first — which is what the
  benchmark above is for.

## Risks

- **A chunk-level constraint violation is diagnosed by a retry loop**, so a corpus
  that trips one on many files degrades to file-at-a-time ingest for those chunks.
  Acceptable because the realistic cause — a misclassified reset — is rare and is a
  bug to fix rather than a state to live in.
- **`run_series` is written through `run_perf`**, so a perf that fails to match drops
  its tick series too. That is correct (the series has nowhere to attach) but it means
  the orphan assertion is the only thing standing between a join regression and
  silently missing series data.
- **The `array_agg(… order by idx)` ordering is not enforced by a constraint.** The
  alignment `CHECK` catches a length mismatch, not a permutation. Mitigated by a
  curated read-back test, not by the schema.
- **Chromium's picker blocklist is path-based and is not a stable documented contract.**
  Watch mode may be unavailable to a given user for reasons we cannot detect ahead of
  the picker call, so the UI must treat a failed pick as ordinary, not exceptional.
- **`FileSystemObserver` availability is version-dependent.** Mitigated to near zero by
  D9: the fallback is an interval running identical code.

## Known gaps

- **The real install layout is assumed, not verified** (D1). Suffix matching means the
  design does not depend on it, but the picker's starting directory hint will.
- **Midnight rollover** remains unsolved, as `ingest.md` records. This design confines
  it to `classify.ts` rather than closing it.
- **Two files written in the same second** — `ingest.md`'s open question — would break
  stem uniqueness and therefore dedupe. Nothing here can settle it; if it happens, the
  `on conflict (file_stem) do nothing` in D6 silently keeps the first, which is the
  wrong file half the time. Unchanged from the schema's exposure to the same gap.
