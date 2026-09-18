# Data layout for KovaaK's run history

Status: proposed. Scope: the shape of the data in PGlite — tables, types, constraints,
indexes, views, and how the schema evolves. Ingest code, parsers and UI are out of scope;
this specifies the target they write to and read from.

Prerequisites: [`ingest.md`](../../ingest.md) (what a run *is*, how CSV and `.perf` pair,
which fields are valid when) and [`perf-format.md`](../../perf-format.md). This document
does not restate their findings; it encodes them.

## Summary

- `run` is the spine — one row per `Stats.csv`, matching the rule that a run is a CSV and
  the `.perf` is an optional attachment.
- Scenario, client config, game version, bot and weapon become small dimension tables.
- Per-run detail (kill table, perf tick series) is stored as **aligned parallel arrays**,
  one row per run, exposed through `unnest` views that make them look like tables.
  Measured: 3–5× smaller than row-per-record, 2× faster to ingest, same query speed.
- Per-run aggregates are materialized at ingest because a run never changes after it is
  written. Cross-run aggregates (percentiles, PBs, sessions) are computed at query time,
  because at this cardinality they cost single-digit milliseconds.
- Invariants from `ingest.md` are database constraints, not conventions.
- Migrations are ordinary forward migrations, with an explicit destructive escape hatch.

Measured total at 10,000 runs: **~37 MB**.

## Context

The corpus is one player's KovaaK's output: 2496 `Stats.csv` and 2164 `.perf` files today,
with ~10,000 CSV+perf pairs as the design target. It lives in PGlite (PostgreSQL 18.3,
WebAssembly) persisted in the browser, with the same schema opened in-memory under vitest.
There is no server and no second writer.

Everything in this document that says "measured" was measured against
`test/fixtures/raw/` on 2026-09-18; the numbers are collected in the appendix.

## Decisions

### D1. `run` is one row per CSV, keyed by filename stem

`ingest.md` establishes `.perf ⊆ .csv` — every perf has a CSV, 310 CSVs have no perf, and
perf-only runs do not occur. So the CSV is the row and the perf is an attachment, and there
is no path that reconstructs a run from a perf alone.

`file_stem` is the natural key: unique on disk by construction, measured at 2468 distinct
values with 0 collisions, and never rewritten. It carries the two properties that matter —
re-ingesting the same file is a no-op rather than a duplicate, and identity does not depend
on any counter that collides (`(Hash, shots, hits)` collides 75 times in 2468 files).

An `integer` surrogate `id` is the foreign key everywhere else, because the detail tables
reference it once per run and a 4-byte key keeps the arrays and rollups narrow.

### D2. Aborts do not live in `run`

An abort file has empty `Scenario:` and `Hash:`, and is named after a scenario that was not
being played. It has no scenario identity, so it cannot participate in any query in this
schema. Putting it in `run` would force `scenario_id` to be nullable and push a NULL check
into every join, for 1 file in 2496.

Aborts go to `unattributed_file` — file stem, write time, and the **whole parsed document**
as `jsonb`, not just the key/value block: the one abort in the corpus has an empty kill
table but a real weapon row with 1306 shots and 827 hits, so storing only the key/value
block would make "nothing is silently dropped" false. Nothing is dropped, the count stays
visible, and `run` keeps a `NOT NULL` scenario.

One consequence to accept knowingly: aborts are outside `run`, so `run_session` cannot see
them, and an abort that bridges a gap will split one session in two. `run_kind` is therefore `('complete', 'reset')`; classification still
has three branches at ingest, and the third routes here.

### D3. Scenario identity is the hash

`Hash:` identifies the scenario at the exact version that produced the run; grouping by name
lets an edited scenario silently pollute a progress curve. `scenario.hash` is the unique
key and `name` is an attribute of it. Measured: 316 scenarios, 316 hashes, no scenario yet
observed with two hashes — but the whole point is that the day one appears, the curve splits
instead of merging.

**Dimension text is trimmed before interning, and the constraint says so.** The naive
contract — intern the string verbatim — is already violated by the corpus: the bot
`" speedswitch "` (leading and trailing spaces, 520 kill rows) and `"speedswitch"` (508
rows) **alternate within the same file**. Interning verbatim would split one bot into two
dimension rows, give a single run two `run_bot` rows for the same bot, and halve every
per-bot statistic across the `VT Speedswitch` family. The measured 124 distinct bot names
are 123 after trimming; weapons are already clean at 18. `bot` and `weapon` therefore carry
`check (name = btrim(name) and name <> '')`, so an ingest that forgets to trim fails loudly
instead of quietly forking a dimension.

### D4. The settings block becomes a `config` dimension

The 15 client-configuration keys are **53 distinct combinations across 2495 runs**. As a
dimension they cost 53 rows, and they turn the most important confound check — "did sens,
FOV, DPI, crosshair or resolution change between these runs?" — into `config_id <> config_id`
instead of a 15-column comparison.

The stated worry is that this table grows. Its bound is one row per run, which is reached
only if every run has a unique configuration — Random Sensitivity mode is the realistic way
that happens. **In that worst case the design costs exactly what inlining the columns would
have cost**, plus a 4-byte foreign key: it degrades to the un-deduplicated layout and never
does worse. Today it is 53 rows against 2495, so it is 47× better than inlining.

Uniqueness is a natural `UNIQUE` over all configuration columns rather than a hash
fingerprint. A generated hash would need `real::text`, whose immutability depends on a GUC;
at this cardinality the wide index costs nothing and the natural key cannot drift from the
data it describes.

`Avg Target Scale` and `Avg Time Dilation` are deliberately **not** in `config`: despite
being constant at 1.0 in the corpus, they are per-run measurements, not settings, and
putting a measurement in a dimension key is how a dimension explodes. They go to
`run.extra` when they differ from 1.0.

### D5. Per-run detail is stored as aligned parallel arrays

The kill table and the perf tick series are both per-run sequences that are always read
whole, for one run or for the runs of one scenario. Stored as arrays with an `unnest` view
on top, they are dramatically cheaper and no slower:

| | rows | arrays | at 10k runs |
| --- | ---: | ---: | --- |
| perf series | 13.1 MB (133k rows) | **4.5 MB** | 60 MB → **21 MB** |
| kill table | 8.5 MB (75.5k rows) | **1.8 MB** | 34 MB → **7.3 MB** |
| ingest (COPY) | 1.0 s + 0.49 s | **0.47 s + 0.26 s** | ~4 s total |

Query cost is a wash — scenario-scoped percentile queries came out 24.5 ms vs 30.8 ms
(tick curves) and 3.1 ms vs 4.5 ms (bot breakdown), in both directions. Only a full-corpus
tick scan is materially slower (43 ms vs 147 ms), and that is not one of the use cases.

Two properties make this safe rather than clever:

- The pivot from events to ticks is **lossless**: `(timestamp, event type)` is unique in all
  2164 perf files, 815,361 events for 815,361, 0 duplicates. Nothing has to be discarded or
  merged to make a run's events into a rectangle.
- Alignment is a `CHECK` constraint (`cardinality(a) = cardinality(b) = …`), so a
  misaligned write is rejected rather than silently producing skewed rows through `unnest`.
  Verified: the constraint rejects mismatched arrays.

Reversibility was a stated condition, and it mostly holds, with one caveat worth stating
precisely. The views are the query surface, so converting to row-per-record later means
replacing the base table and keeping the same name in front of it — no query written
against `tick` or `kill` changes. But `kill` cannot become a *plain* table: `t_offset`
depends on `run.start_ms`, and a generated column cannot reference another table, so `kill`
stays a view over a row-shaped base table rather than becoming one. The conversion is a
migration of storage plus a thinner view, not the deletion of a view.

### D6. Materialize per-run facts; compute cross-run facts at query time

The rule that makes this unambiguous: **a run never changes after it is written**. So any
aggregate scoped to a single run is immutable and can be written once at ingest with no
invalidation logic. Any aggregate spanning runs changes whenever a run is added, and is
therefore computed on read.

Materialized at ingest: `run` totals, taken from the CSV rather than recomputed from the
series — from the key/value block where a key exists, and from the weapon table for `shots`
and `damage_possible`, which have no key of their own. And `run_bot` — per (run, bot)
kills, mean TTK, shots, hits, damage.
Measured 3111 rows for the corpus, 1.7 MB at 10k runs, and it is the fastest path for the
bot-breakdown use case (2.4 ms, against 3.1 ms from kill rows and 4.5 ms from kill arrays).

Computed at query time: percentiles, personal bests, ranks, sessions, rolling windows.
Measured on the full corpus: one scenario's p50/p90/mean/best in 1.5 ms, all 316 scenarios
at once in 13 ms, a run plus the PB preceding it in 2.8 ms, session segmentation over the
entire history in 3.7 ms. Nothing here justifies a materialized view yet; if one later
does, it slots in behind the same view name.

### D7. Invariants from `ingest.md` become constraints

- **`kind`** is set by ingest from the documented interval rule and stored. It is never
  re-derived downstream, and never inferred from `Avg FPS` — `ingest.md` records that
  `Avg FPS == 0` misclassifies 3 of 22 resets, because uninitialised values around 7.3e9
  occur.
- **`started_at` is `NULL` unless `kind = 'complete'`**, enforced by
  `CHECK ((kind = 'complete') = (started_at IS NOT NULL))`. A reset file is stamped with
  the *next* attempt's start; storing that value in a column named `started_at` is an
  invitation to use it. The raw parsed value is preserved in `extra.raw` so nothing is lost.
- **`written_at`** (filename timestamp, end of second) is `NOT NULL` for every kind — it is
  the one timestamp that is trustworthy in all three file shapes.
- **No two complete runs overlap.** `span` is a generated `tstzrange` over
  `[started_at, written_at)` for complete runs and `NULL` otherwise, with
  `EXCLUDE USING gist (span WITH &&) WHERE (kind = 'complete')`. Verified: the constraint
  rejects an overlapping complete run and accepts both a non-overlapping one and a partial.

  This is the same fact the CSV↔perf join relies on ("a player cannot be inside two
  completed runs at once", measured 0 overlapping complete intervals in the corpus). Stating
  it once as a constraint means the join's precondition is checked on every insert instead
  of being assumed.

  The constraint's GiST index also serves the join itself — but **not** through plain
  containment. `span` starts at `Challenge Start` with milliseconds, while the perf's
  `challenge_start_utc` is that instant truncated to the whole second and therefore almost
  always *earlier*: measured over 2156 pairs, `challenge_start_utc >= started_at` in only 4
  of them, delta −997 ms to +3 ms. `span @> challenge_start_utc` finds nothing. The join
  needs the 1000 ms of lower-bound slack `ingest.md` specifies, written as an overlap
  against a one-second probe range:

  ```sql
  select id from run
  where kind = 'complete'                          -- required; see the index note below
    and span && tstzrange($1::timestamptz, $1::timestamptz + interval '1 second');
  ```

  Verified: the containment form returns 0 rows for a run starting at `10:20:00.503` probed
  with `10:20:00`, the overlap form returns the run, and it plans as an index scan on
  `no_overlapping_runs` against 2500 runs. The 1000 ms is a property of the format —
  truncation discards at most 999 ms — not a tuning parameter.

  **The `kind = 'complete'` predicate must be repeated in the query.** The index is partial,
  and the planner cannot prove `span IS NOT NULL ⇒ kind = 'complete'` through a generated
  column; without it the query seq-scans.
- **Only actively dangerous values are nulled.** The tempting rule — null everything
  `ingest.md` lists as invalid in a partial — destroys real data. Measured across the 21
  resets in the corpus: `Avg TTK` is 0 in 21/21 and `Avg FPS` is never plausible in 21/21,
  but **`Score` is non-zero in 16 of 21** and `Fight Time` in 2 of 21. That matches
  `ingest.md` footnote ¹ exactly: score is zeroed only where it is *derived* at run end, and
  survives where it is a raw accumulator.

  So the rule is narrower. Nulled for a reset: `started_at` / `start_ms`, because a reset
  carries the *next* attempt's start and that value is actively wrong for ordering and for
  `span`; and `avg_fps`, because it is uninitialised memory that can read 7.3e9 and would
  poison any average. Everything else is stored verbatim per D8, and `kind` filtering is
  what keeps partials off the performance axes. `extra.raw` holds only the discarded
  `Challenge Start` and `Avg FPS`.

  A reset's `Avg TTK` and `Fight Time` of `0.0` are stored as `0.0` and remain ambiguous —
  `ingest.md` notes `Fight Time` reads 0.0 when the player reset mid-engagement rather than
  meaning no time elapsed. That ambiguity is in the format, and inventing a `NULL` would
  not resolve it.

### D8. Store what the file says; derive what the analysis wants

Kill timestamps are stored as `at_ms integer[]` — milliseconds since local midnight, exactly
as the file gives them — rather than as offsets resolved at ingest. `run.start_ms` holds
`Challenge Start` in the same form, so the `kill` view subtracts two integers from the same
clock. Resolving the offset through `started_at` instead would make it depend on the session
`TimeZone` setting, which differs between the browser and vitest. Offsets against
`Challenge Start` are invalid in a reset (`ingest.md` has a kill 4.1 s *before* the run
supposedly began), while the timestamps themselves are valid in every kind, as are the
inter-kill deltas derived from them. The `kill` view computes `t_offset` for complete runs
and leaves it `NULL` otherwise, so the documented midnight-rollover gap stays a single
view-level concern instead of being baked into stored data.

The same principle covers the `overshots` closer. Each perf that records overshots ends with
one negative event zeroing the counter. It is stored **as written**; `run.total_overshots`
from the CSV is the authoritative run total, and any cumulative overshot curve must use
`greatest(overshots, 0)`. Normalising it away at ingest would make the stored series differ
from the file for no gain, since the total already comes from elsewhere.

### D9. The key/value block does not become a key/value column

The 42 keys are a fixed, documented, parser-validated set. Typed columns are faster,
indexable, and let a KovaaK's rename fail loudly at ingest, which is the parser's existing
stance. `hstore`/`jsonb` earns its place only for the open-world part:

- unknown keys a future game version adds, which the parser currently ignores;
- the counters that are constant at their default in the whole corpus (`Deaths`, `Midairs`,
  `Midaired`, `Directs`, `Directed`, `Avg Target Scale`, `Avg Time Dilation`) — recorded in
  `extra` **only when they are non-default**, so they cost nothing today and lose nothing
  the day the format grows;
- `extra.raw`, the parsed-but-invalid values on partial runs.

`jsonb` rather than `hstore`: no extension to load, and it keeps numbers as numbers.

`Cheated` **is** stored, as an ordinary aligned array. `stats-csv.ts` labels it `[unknown]`
on the basis that it is 0 throughout, and an earlier draft of this spec had ingest raise on
a non-zero value — but it is not 0 throughout. Measured: exactly **1 of 75,504 kill rows**
is `Cheated = 1`, in `VT Speedswitch 90 Novice - Challenge - 2026.05.14-15.27.39`. A raise
would hard-fail ingest on a file already in the fixture set. A flag that fires once in a
corpus is considerably more interesting than one that never fires, and at 0.6 MB per 10,000
runs it does not need a special case.

### D10. Migrations are ordinary forward migrations with a destructive escape hatch

Adding an index, a view or a computable column must not cost a reingest. But a change that
introduces a column no existing row can be backfilled with legitimately can, and reingest is
~4 seconds.

So: numbered SQL files applied in order, tracked in `_migrations(name, hash, applied_at)`,
extending the mechanism already in `src/db/migrate.ts`. The migrator drops and replays
rather than applying forward in exactly five cases:

1. a pending migration declares itself destructive with a leading `-- reset: <reason>` line;
2. the recorded hash of an already-applied migration no longer matches the file (someone
   edited applied SQL — the normal development loop for this project);
3. an already-applied migration has disappeared;
4. the applied migrations, ordered by `applied_at`, are not a prefix of the file list **in
   the same order**. Rules 2 and 3 key on name and hash only, so merging a branch that adds
   `0007_x.sql` after `0008_y.sql` is already applied would otherwise trigger nothing — and
   a migrated database would have y-then-x while a fresh one has x-then-y, quietly breaking
   the "identical by construction" property below;
5. `_migrations` exists without a `hash` column, i.e. it was written by the current
   migrator. Every browser database in existence today is in this state, and there is no
   way to know whether its schema matches the files. Resetting is the only sound answer.

A reset is `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` followed by **replaying the
same migration list from the beginning**. There is deliberately no separate "current schema"
file: one source of truth, and a freshly-built database and a migrated one are identical by
construction rather than by discipline. Verified that the drop-and-recreate leaves 0 tables
*and* 0 enum types, so the `run_kind` type does not survive to collide on replay.

Two implementation obligations, both of which silently destroy user data if missed:

- **Hash normalised text, not raw bytes.** `core.autocrlf` is on in this repo, `.gitattributes`
  has no `*.sql` rule, and the existing `drizzle/0000_*.sql` is on disk with CRLF. Whatever
  `import.meta.glob(…, '?raw')` yields depends on the checkout, so a formatter run, a
  `.gitattributes` addition, or a Linux CI build replacing a Windows one would change every
  hash and trigger rule 2 for every user. Normalise line endings and trim before hashing.
- **Apply the DDL and record it in one transaction.** `pg.exec()` is atomic per call, so a
  failing multi-statement migration rolls back cleanly — but `applyMigrations` currently
  runs `exec(sql)` and then a separate `INSERT INTO _migrations`. A crash or a closed tab
  between the two replays the DDL on next load, which fails with "already exists" while
  rule 2 does *not* fire, because nothing was ever recorded. That state has no recovery
  path. One transaction around both removes the window.

The migrator returns whether a reset happened, which is the signal the ingest layer needs to
know its data is gone. What it does with that signal is out of scope here.

**The first deployment of this design is itself a reset**, by rules 3 and 5: it deletes
`0000_massive_human_torch.sql` and `_migrations` has no `hash` column. Every existing
browser database is wiped on the upgrade. That is intended — the only thing in them is the
`notes` placeholder — but it should be a stated consequence rather than a surprise.

Consequence for tooling: `drizzle-kit` is dropped along with `pnpm db:generate` and the
generated `drizzle/` output, because it models almost nothing this schema uses — views,
generated columns, exclusion constraints, partial and covering indexes, triggers, arrays
with alignment checks. Migrations become hand-written SQL in `src/db/sql/`, loaded by the
existing `import.meta.glob` mechanism. Drizzle stays as a typed client for simple reads and
writes; the analytics are hand-written SQL either way.

### D11. PGlite runs in a Web Worker

PGlite is single-threaded WebAssembly, so both a 40 ms query and a ~4 s bulk ingest block
whatever thread they run on. The database goes in a worker (`@electric-sql/pglite/worker`)
with the UI talking to it over the worker interface; live queries work through it. This is
the only significant performance risk in the design — the query plans are not.

Bulk loading uses `COPY … FROM '/dev/blob'`, which is what the ~4 s figure measures.

## Schema

```sql
create type run_kind as enum ('complete', 'reset');

-- Dimensions ---------------------------------------------------------------

create table scenario (
  id    integer generated always as identity primary key,
  hash  char(32) not null unique,
  name  text     not null
);

create table game_version (
  id    smallint generated always as identity primary key,
  label text not null unique
);

-- smallint ids: these two are referenced from inside arrays, where element
-- width is multiplied by 75k kill rows. Measured cardinality 124 and 18.
-- btrim checks: the corpus contains " speedswitch " and "speedswitch" (D3).
create table bot (
  id   smallint generated always as identity primary key,
  name text not null unique,
  constraint bot_name_trimmed check (name = btrim(name) and name <> '')
);

create table weapon (
  id   smallint generated always as identity primary key,
  name text not null unique,
  constraint weapon_name_trimmed check (name = btrim(name) and name <> '')
);

-- The 15 client-configuration keys. 53 rows for 2495 runs; see D4.
create table config (
  id               integer generated always as identity primary key,
  sens_scale       text             not null,
  sens_increment   double precision not null,
  horiz_sens       real             not null,
  vert_sens        real             not null,
  dpi              integer          not null,
  fov              real             not null,
  fov_scale        text             not null,
  hide_gun         boolean          not null,
  crosshair        text             not null,
  crosshair_scale  real             not null,
  crosshair_color  char(8)          not null,
  resolution       text             not null,
  resolution_scale real             not null,
  max_fps_config   real             not null,
  input_lag        real             not null,
  unique (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov, fov_scale,
          hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
          resolution_scale, max_fps_config, input_lag)
);

-- The spine ----------------------------------------------------------------

create table run (
  id              integer generated always as identity primary key,
  file_stem       text not null unique,

  scenario_id     integer  not null references scenario,
  config_id       integer  not null references config,
  game_version_id smallint not null references game_version,

  kind        run_kind    not null,
  started_at  timestamptz,           -- Challenge Start; null unless complete (D7)
  start_ms    integer,               -- same instant as ms since local midnight (D8)
  written_at  timestamptz not null,  -- filename timestamp, end of second
  duration_s  real,                  -- null unless complete

  span tstzrange generated always as (
    case when kind = 'complete' then tstzrange(started_at, written_at, '[)') end
  ) stored,

  -- Run totals, from the CSV's own key/value block (never recomputed from the
  -- series). shots and damage_possible are the sum of the weapon table.
  score             real,
  kills             integer,
  hit_count         integer not null,
  miss_count        integer not null,
  shots             integer not null,
  damage_done       real,
  damage_possible   real,
  damage_taken      real,
  total_overshots   integer,
  reloads           integer,
  distance_traveled double precision,
  mbs_points        real,
  fight_time_s      real,
  time_remaining_s  real,
  avg_ttk_s         real,
  pause_count       integer,
  pause_duration    real,
  avg_fps           real,             -- null for a reset: uninitialised there

  accuracy   real generated always as (hit_count::real / nullif(shots, 0)) virtual,
  efficiency real generated always as (damage_done / nullif(damage_possible, 0)) virtual,

  extra jsonb not null default '{}',

  constraint complete_has_start
    check ((kind = 'complete') = (started_at is not null)),
  constraint complete_has_start_ms
    check ((kind = 'complete') = (start_ms is not null)),
  constraint complete_has_duration
    check ((kind = 'complete') = (duration_s is not null)),
  -- Rejects the empty range (started_at = written_at, which would escape the
  -- exclusion constraint entirely) and turns a midnight-rollover mistake into a
  -- named constraint violation instead of an opaque range error.
  constraint complete_ends_after_start
    check (kind <> 'complete' or written_at > started_at),
  -- Avg FPS in a reset is uninitialised memory, observed up to 8.9e9.
  constraint fps_only_when_complete
    check (kind = 'complete' or avg_fps is null),
  -- Holds in 2495/2495 measured CSVs; a KovaaK's change to any of the three
  -- should fail at ingest rather than quietly skew accuracy.
  constraint shots_balance
    check (shots = hit_count + miss_count),
  constraint no_overlapping_runs
    exclude using gist (span with &&) where (kind = 'complete'),
  -- Referenced by run_perf, so that a .perf can only attach to a complete run.
  constraint run_id_kind unique (id, kind)
);

create index run_scenario_time  on run (scenario_id, started_at) include (score)
                                where kind = 'complete';
create index run_scenario_score on run (scenario_id, score desc)
                                where kind = 'complete';
create index run_written        on run (written_at desc);
create index run_config         on run (config_id) where kind = 'complete';
-- Not partial: the reroll-rate and attempt-numbering queries span both kinds.
create index run_scenario_kind  on run (scenario_id, kind);
create index scenario_name      on scenario (name);

-- Abort files: no scenario identity, so they cannot join anything (D2).
-- payload is the whole parsed document, not just the key/value block: the one
-- abort in the corpus has an empty kill table but a real weapon row with 1306
-- shots and 827 hits, which "nothing is silently dropped" has to cover.
create table unattributed_file (
  file_stem  text primary key,
  written_at timestamptz not null,
  payload    jsonb not null
);

-- Per-run detail, as aligned arrays (D5) -----------------------------------

create table kill_series (
  run_id          integer primary key references run on delete cascade,
  at_ms           integer[]  not null,  -- ms since local midnight, verbatim (D8)
  bot_id          smallint[] not null,
  weapon_id       smallint[] not null,
  ttk             real[]     not null,
  shots           smallint[] not null,
  hits            smallint[] not null,
  damage_done     real[]     not null,
  damage_possible real[]     not null,
  overshots       smallint[] not null,
  cheated         smallint[] not null,  -- 1 of 75,504 rows is non-zero (D9)
  constraint kill_series_aligned check (
    cardinality(cheated)   = cardinality(at_ms) and
    cardinality(bot_id)    = cardinality(at_ms) and
    cardinality(weapon_id) = cardinality(at_ms) and
    cardinality(ttk)       = cardinality(at_ms) and
    cardinality(shots)     = cardinality(at_ms) and
    cardinality(hits)      = cardinality(at_ms) and
    cardinality(damage_done)     = cardinality(at_ms) and
    cardinality(damage_possible) = cardinality(at_ms) and
    cardinality(overshots) = cardinality(at_ms)
  )
);

create table run_weapon (
  run_id          integer  not null references run on delete cascade,
  weapon_id       smallint not null references weapon,
  shots           integer not null,
  hits            integer not null,
  damage_done     real    not null,
  damage_possible real    not null,
  primary key (run_id, weapon_id)
);

-- Per-run, per-bot rollup. Immutable once written, so it is maintained at
-- ingest rather than refreshed (D6).
create table run_bot (
  run_id          integer  not null references run on delete cascade,
  bot_id          smallint not null references bot,
  kills           integer not null,
  avg_ttk         real    not null,
  shots           integer not null,
  hits            integer not null,
  damage_done     real    not null,
  damage_possible real    not null,
  overshots       integer not null,
  accuracy real generated always as (hits::real / nullif(shots, 0)) virtual,
  primary key (run_id, bot_id)
);

create index run_bot_bot on run_bot (bot_id);

-- The .perf attachment ------------------------------------------------------

create table run_perf (
  run_id              integer primary key references run on delete cascade,
  -- A .perf is only written on completion, so it can only attach to a complete
  -- run. Enforced with a composite FK, since a CHECK cannot span tables.
  kind                run_kind not null default 'complete' check (kind = 'complete'),
  -- The perf's own filename stem, which can differ from the CSV's: 8 pairs in
  -- the corpus are named a second apart. Without it, ingest has no dedup key
  -- for perfs and "0 perfs claimed twice" is not re-derivable from the database.
  perf_file_stem      text not null unique,
  schema_version      smallint not null,
  challenge_start_utc timestamptz not null,  -- truncated to the second by the format
  time_limit                real,
  timescale                 real,
  map_name                  text,
  map_scale                 real,
  player_profile            text,
  player_team               smallint,
  player_max_lives          integer,
  end_challenge_after_kills real,
  end_challenge_after_damage real,
  added_bots     text[]     not null,
  bot_max_lives  smallint[],
  bot_teams      smallint[],
  constraint bots_aligned check (
    (bot_max_lives is null or cardinality(bot_max_lives) = cardinality(added_bots)) and
    (bot_teams     is null or cardinality(bot_teams)     = cardinality(added_bots))
  ),
  foreign key (run_id, kind) references run (id, kind) on delete cascade
);

-- The 13 event types observed in the corpus, one array each, tick-aligned.
-- A type outside this set makes ingest raise; adding one is a migration.
create table run_series (
  run_id integer primary key references run on delete cascade,
  t                   real[] not null,   -- seconds since challenge start
  shots_fired         integer[],
  shots_hit           integer[],
  shots_missed        integer[],
  damage_done         real[],
  damage_possible     real[],
  score               real[],
  kills               integer[],
  overshots           integer[],         -- includes the terminal negative closer (D8)
  player_damage_taken real[],
  reloads             integer[],
  pause_count         integer[],
  distance_traveled   real[],
  mbs_points          real[],
  constraint run_series_aligned check (
    (shots_fired     is null or cardinality(shots_fired)     = cardinality(t)) and
    (shots_hit       is null or cardinality(shots_hit)       = cardinality(t)) and
    (shots_missed    is null or cardinality(shots_missed)    = cardinality(t)) and
    (damage_done     is null or cardinality(damage_done)     = cardinality(t)) and
    (damage_possible is null or cardinality(damage_possible) = cardinality(t)) and
    (score           is null or cardinality(score)           = cardinality(t)) and
    (kills           is null or cardinality(kills)           = cardinality(t)) and
    (overshots       is null or cardinality(overshots)       = cardinality(t)) and
    (player_damage_taken is null or cardinality(player_damage_taken) = cardinality(t)) and
    (reloads         is null or cardinality(reloads)         = cardinality(t)) and
    (pause_count     is null or cardinality(pause_count)     = cardinality(t)) and
    (distance_traveled is null or cardinality(distance_traveled) = cardinality(t)) and
    (mbs_points      is null or cardinality(mbs_points)      = cardinality(t))
  )
);
```

### Array contracts

These are the obligations on whatever writes these tables. They are not all expressible as
constraints, so they are stated here rather than left implicit.

- **A whole metric array is `NULL` when the run never emitted that event**, which the vendor
  documents as "not applicable to this scenario" rather than zero — tracking scenarios omit
  `reloads`, semi-auto scenarios omit `overshots`. A `NULL` array preserves that
  distinction; a zero-filled one would destroy it.
- **Inside a non-`NULL` array, a tick where that metric did not change is `NULL`, not `0`.**
  Events are emitted only for metrics that changed during a tick, so the two are different
  facts, and the choice changes what `avg()` and `count()` return. Note the consequence:
  through the `tick` view a wholly-absent metric and a metric that simply did not fire at
  that tick are indistinguishable — both render as a `NULL` cell. The distinction survives
  only in the base table, so a query that needs it must ask `run_series` directly. This is
  the one case where the "nothing outside ingest reads the arrays" rule has an exception.
- **`run_series.t` is strictly increasing.** `tick_no = ord - 1` and every cumulative query
  depend on it. Measured: 0 of 2164 files are non-monotonic and 0 have duplicate tick
  timestamps. This is not enforced — a `CHECK` cannot contain a subquery, so it would need
  an `IMMUTABLE` helper function — and is listed here as an ingest obligation and a risk.
- **`run_perf.challenge_start_utc` lands on a whole second** (`% 1000 == 0` in all 2164
  files). Asserted at ingest rather than by a `CHECK`, because the obvious formulations
  (`date_trunc`, `extract`) are `STABLE` on `timestamptz` — they depend on the session
  `TimeZone` — and are therefore not allowed in a constraint.

## Views

The views are the query surface. Nothing outside ingest reads the array columns directly.

```sql
-- One row per tick. tick_no is what makes cross-run curve comparison an
-- equi-join rather than a range join.
create view tick as
select s.run_id, (x.ord - 1)::smallint as tick_no,
       x.t, x.shots_fired, x.shots_hit, x.shots_missed, x.damage_done,
       x.damage_possible, x.score, x.kills, x.overshots,
       x.player_damage_taken, x.reloads, x.pause_count,
       x.distance_traveled, x.mbs_points
from run_series s,
     unnest(s.t, s.shots_fired, s.shots_hit, s.shots_missed, s.damage_done,
            s.damage_possible, s.score, s.kills, s.overshots,
            s.player_damage_taken, s.reloads, s.pause_count,
            s.distance_traveled, s.mbs_points)
     with ordinality as x(t, shots_fired, shots_hit, shots_missed, damage_done,
                          damage_possible, score, kills, overshots,
                          player_damage_taken, reloads, pause_count,
                          distance_traveled, mbs_points, ord);

-- One row per kill. t_offset is null for a reset, where offsets against
-- Challenge Start are meaningless; inter-kill deltas from at_ms are not.
create view kill as
select k.run_id, (x.ord - 1)::smallint as ordinal, x.at_ms, x.bot_id, x.weapon_id,
       x.ttk, x.shots, x.hits, x.damage_done, x.damage_possible, x.overshots,
       x.cheated <> 0 as cheated,
       x.hits::real / nullif(x.shots, 0) as accuracy,
       x.damage_done / nullif(x.damage_possible, 0) as efficiency,
       -- A plain difference, deliberately not wrapped modulo a day: a negative
       -- value means either a midnight rollover or clock skew, and both should
       -- be visible rather than silently rendered as ~86399.99.
       case when r.start_ms is not null
            then ((x.at_ms - r.start_ms) / 1000.0)::real
       end as t_offset
from kill_series k
join run r on r.id = k.run_id,
     unnest(k.at_ms, k.bot_id, k.weapon_id, k.ttk, k.shots, k.hits,
            k.damage_done, k.damage_possible, k.overshots, k.cheated)
     with ordinality as x(at_ms, bot_id, weapon_id, ttk, shots, hits,
                          damage_done, damage_possible, overshots, cheated, ord);

-- Complete runs with their dimensions resolved. The baseline for analysis:
-- partials are excluded here rather than in every downstream query.
create view run_complete as
select r.*, s.hash as scenario_hash, s.name as scenario_name, g.label as game_version,
       p.run_id is not null as has_perf
from run r
join scenario s on s.id = r.scenario_id
join game_version g on g.id = r.game_version_id
left join run_perf p on p.run_id = r.id
where r.kind = 'complete';

-- Attempt numbering over ALL runs of a scenario, resets included. run_progress
-- cannot answer this: it is defined over completions, so its completion_no is
-- n-th completion, while "a PB set on the 16th attempt" counts rerolls.
create view run_attempt as
select id, scenario_id, kind, written_at,
       row_number() over w as attempt_no,
       count(*) filter (where kind = 'reset')
         over (partition by scenario_id order by written_at
               rows between unbounded preceding and 1 preceding) as resets_before
from run
window w as (partition by scenario_id order by written_at);

-- Per-run position in its scenario's history. See the pushdown rule below.
create view run_progress as
select r.*,
       row_number() over w                                        as completion_no,
       lag(r.score)  over w                                             as prev_score,
       max(r.score)  over (partition by r.scenario_id order by r.started_at
                           rows between unbounded preceding and 1 preceding) as pb_before,
       max(r.score)  over w                                             as best_so_far,
       lag(r.config_id) over w is not null
         and lag(r.config_id) over w <> r.config_id                     as config_changed
from run_complete r
window w as (partition by r.scenario_id order by r.started_at);

-- Sessions: a gap of more than 30 minutes starts a new one. Includes partials,
-- because reroll behaviour is part of what a session is. Three levels, because
-- a window function may not be nested inside another window's PARTITION BY.
create view run_session as
select id, scenario_id, kind, written_at, session_id,
       row_number() over (partition by session_id order by written_at, id)
         as position_in_session
from (
  select id, scenario_id, kind, written_at,
         sum(is_new) over (order by written_at, id) as session_id
  from (
    select id, scenario_id, kind, written_at,
           case when written_at - lag(written_at) over (order by written_at, id)
                     > interval '30 minutes'
                 or lag(written_at) over (order by written_at, id) is null
                then 1 else 0 end as is_new
    from run
  ) flagged
) segmented;
```

### The pushdown rule

`run_progress` partitions by `scenario_id`. A filter on the partitioning column is pushed
into the view and served by `run_scenario_time`; a filter on anything else is applied after
the window has been computed over every row.

Verified on a 100,000-row table — 40× the design target:

| query | rows touched | cost |
| --- | ---: | ---: |
| `where scenario_id = 7` | 334 (bitmap index scan) | 5.2 ms |
| `where score > 990` | 100,000 (full scan) | — |

**Always constrain a window view by its partition key.** To filter on something else, filter
inside a CTE first and apply the window after. This is the single easiest way to make this
schema slow, so it belongs in a comment above each window view.

## Where every documented field goes

### `Stats.csv` key/value block (42 keys)

| key | destination |
| --- | --- |
| `Scenario`, `Hash` | `scenario` dimension, keyed on hash (D3) |
| `Game Version` | `game_version` dimension |
| `Challenge Start` | `run.started_at` + `run.start_ms`, complete runs only; raw value to `extra.raw` otherwise (D7, D8) |
| `Score`, `Kills`, `Hit Count`, `Miss Count`, `Damage Done`, `Damage Taken`, `Total Overshots`, `Reloads`, `Distance Traveled`, `MBS Points`, `Fight Time`, `Time Remaining`, `Avg TTK`, `Pause Count`, `Pause Duration` | typed columns on `run` |
| `Avg FPS` | `run.avg_fps`; `NULL` for a reset, where it is uninitialised |
| `Sens Scale`, `Sens Increment`, `Horiz Sens`, `Vert Sens`, `DPI`, `FOV`, `FOVScale`, `Hide Gun`, `Crosshair`, `Crosshair Scale`, `Crosshair Color`, `Resolution`, `Resolution Scale`, `Max FPS (config)`, `Input Lag` | `config` dimension (D4) |
| `Avg Target Scale`, `Avg Time Dilation` | `run.extra`, only when ≠ 1.0 (D4) |
| `Deaths`, `Midairs`, `Midaired`, `Directs`, `Directed` | `run.extra`, only when non-zero (D9) |
| any unrecognised key | `run.extra` verbatim (D9) |

Not from the key/value block: `run.shots` and `run.damage_possible` are the sum of the
weapon table, and `run.duration_s` is `written_at − started_at`.

### `Stats.csv` per-kill table

| column | destination |
| --- | --- |
| `Kill #` | dropped — it is 0 on every row for destructible-target scenarios; array position is the reliable index |
| `Timestamp` | `kill_series.at_ms` (D8) |
| `Bot`, `Weapon` | `bot` / `weapon` dimensions, interned to `smallint` |
| `TTK`, `Shots`, `Hits`, `Damage Done`, `Damage Possible`, `OverShots` | parallel arrays |
| `Accuracy`, `Efficiency` | not stored — derived in the `kill` view |
| `Cheated` | `kill_series.cheated`, an aligned array; non-zero in 1 of 75,504 rows (D9) |

Rolled up into `run_bot` at ingest (D6).

### `Stats.csv` per-weapon table

Rows go to `run_weapon`. The settings columns its header advertises are never filled and are
ignored, as the parser already does.

### `.perf`

| field | destination |
| --- | --- |
| `scenario_name`, `scenario_hash` | cross-checked against the CSV at ingest; the CSV is the source of record |
| `challenge_start_utc`, `schema_version` | `run_perf` |
| `ChallengeProfileSnapshot` fields 1–12 | `run_perf` (parallel bot arrays for `added_bots`, `bot_max_lives`, `bot_teams`) |
| events 2–8, 10–15 | `run_series` arrays, one per type |
| events 9, 16, 17, 18 (`deaths`, `target_size`, `target_speed`, `random_sens_scale`) | no column — never observed. Ingest raises on an unknown type; adding one is a migration plus a reingest (D10) |

## Worked queries

Each use case, against the corpus, with its measured cost. These are the shapes the schema
is designed around, not an exhaustive list.

**A run with the PB that preceded it** — 2.8 ms:

```sql
select id, started_at, score, pb_before, score - pb_before as delta, completion_no
from run_progress
where scenario_id = $1 and id = $2;
```

**Scenario distribution: n, mean, p50, p90, best** — 1.5 ms for one scenario, 13 ms for all
316 at once:

```sql
select count(*) as n,
       avg(score) as mean,
       percentile_cont(0.5) within group (order by score) as p50,
       percentile_cont(0.9) within group (order by score) as p90,
       max(score) as best
from run_complete
where scenario_id = $1;
```

**Bot breakdown for one run against the scenario's history** — 2.4 ms through `run_bot`.

Read the statistic carefully: these are percentiles **over per-run means**, so `p50_ttk` is
"the median run's mean TTK against this bot", which is the run-to-run comparison the use
case asks for — the same axis as a run's p50 score. It is *not* the median of individual
kills, which is a wider distribution and a different question. The target run is excluded
from its own comparison population.

```sql
with target as (select id, scenario_id from run where id = $1),
mine as (
  select b.bot_id, b.kills, b.avg_ttk, b.accuracy
  from run_bot b join target t on t.id = b.run_id
),
history as (
  select b.bot_id,
         count(*) as runs,
         percentile_cont(0.5) within group (order by b.avg_ttk)  as p50_ttk,
         percentile_cont(0.9) within group (order by b.avg_ttk)  as p90_ttk,
         min(b.avg_ttk)                                          as best_ttk,
         percentile_cont(0.5) within group (order by b.accuracy) as p50_accuracy,
         percentile_cont(0.9) within group (order by b.accuracy) as p90_accuracy,
         max(b.accuracy)                                         as best_accuracy
  from run_bot b
  join run_complete r on r.id = b.run_id
  join target t on t.scenario_id = r.scenario_id
  where b.run_id <> t.id
  group by b.bot_id
)
select * from mine left join history using (bot_id);
```

The kill-level version of the same statistic — percentiles over individual TTKs rather than
over run means — requires unnesting `kill_series` for every run of the scenario, since
`bot_id` lives inside an array and cannot be indexed. Measured at 4.5 ms for a 234-run
scenario, so it is affordable; it is simply a different question, and `run_bot` does not
answer it.

**PB timeline for a scenario** — 2.5 ms:

```sql
select started_at, score
from run_progress
where scenario_id = $1 and (pb_before is null or score > pb_before);
```

**This run's score curve against the scenario's band.** Align on **elapsed time, not
`tick_no`** — see the cadence warning below — and expose the support count:

```sql
with cum as (
  select run_id, floor(t)::int as second,
         sum(score) over (partition by run_id order by t) as c
  from tick
  where run_id in (select id from run_complete where scenario_id = $2)
),
band as (
  select second, count(*) as n,
         percentile_cont(0.5) within group (order by c) as p50,
         percentile_cont(0.9) within group (order by c) as p90
  from cum group by second
  having count(*) >= 5          -- suppress the tail, where n collapses to 1
),
mine as (
  select floor(t)::int as second, sum(score) over (order by t) as c
  from tick where run_id = $1
)
select * from mine full join band using (second) order by second;
```

Measured at 24.5 ms for a 116-run scenario in the tick-table form and 30.8 ms through the
array view.

**`tick_no` is a per-run ordinal, not a cross-run clock.** `perf-format.md` records that the
~1 Hz cadence is not uniform — 147 gaps exceed 2 s, up to 11.0 s. Joining runs on `tick_no`
therefore compares different wall-clock moments. Measured across the corpus: **17 of 284
scenarios (177 runs) have ≥2 s of spread in `t` at a common tick index**, worst case
`VT Popcorn Novice S5` at 47.98 s–57.98 s for the same index; well-behaved scenarios such as
`SYW (Smooth Your Wrist) Truly FIXED` spread by 0.03 s over 116 runs. The failure is
scenario-dependent and silent, which is the dangerous combination.

Separately, **56 of 284 scenarios have runs of differing tick counts**, so without the
`HAVING` filter the tail of the band is computed over a shrinking population and a "p90"
over one run looks exactly like a real one. `tick_no` remains the right key for a *single*
run's ordering and for `unnest` ordinality; it is the wrong key for pooling runs.

**A PB with the reroll cost that produced it** — `ingest.md`'s "a PB set on the 16th attempt
is not the same result as one set first try", which needs `run_attempt` rather than
`run_progress`:

```sql
select p.id, p.started_at, p.score, a.attempt_no, a.resets_before
from run_progress p
join run_attempt a on a.id = p.id
where p.scenario_id = $1 and (p.pb_before is null or p.score > p.pb_before);
```

**Reroll rate per scenario** — partials are the point here, which is why they are ingested:

```sql
select scenario_id,
       count(*) filter (where kind = 'reset')    as resets,
       count(*) filter (where kind = 'complete') as completes,
       count(*) filter (where kind = 'reset')::real / nullif(count(*), 0) as reroll_rate
from run group by scenario_id;
```

**Sessions, and performance by position within one** — 3.7 ms to segment the whole history:

```sql
select s.position_in_session, avg(p.score / nullif(b.p50, 0)) as normalised
from run_session s
join run_complete p on p.id = s.id
join (select scenario_id, percentile_cont(0.5) within group (order by score) as p50
      from run_complete group by scenario_id) b on b.scenario_id = p.scenario_id
group by s.position_in_session order by 1;
```

**Confound annotation** — `run_progress.config_changed` flags a settings change against the
previous attempt; `game_version_id` and `avg_fps` cover the other two documented confounds.

## Change notification

Both mechanisms were verified working in PGlite 0.5.8.

**Batch-level notification** for "something was ingested": a statement-level trigger using a
transition table, firing exactly one `pg_notify` per statement rather than one per row.

```sql
create function notify_run_ingested() returns trigger language plpgsql as $$
begin
  perform pg_notify('run_ingested',
    json_build_object('count', (select count(*) from inserted),
                      'max_id', (select max(id) from inserted))::text);
  return null;
end $$;

create trigger run_ingested
after insert on run
referencing new table as inserted
for each statement execute function notify_run_ingested();
```

Consumed with `pg.listen('run_ingested', handler)`.

**Live queries** for the views the UI binds to, via `@electric-sql/pglite/live`:
`pg.live.query(sql, params, cb)` re-runs and pushes on change, and
`pg.live.incrementalQuery(sql, params, key, cb)` diffs by key so a growing list updates
incrementally instead of re-rendering wholesale. Verified against a view containing window
functions.

`pg_notify` has an 8000-byte payload limit, so the payload carries counts and ids, never row
contents — a listener that needs the rows queries for them.

## Resetting the current schema

The `notes` placeholder and its tooling go: the table, `drizzle/0000_massive_human_torch.sql`,
`drizzle/meta/`, the `notes` tests in `src/db/db.test.ts`, the `drizzle-kit` dependency,
`drizzle.config.ts`, and the `db:generate` script. `src/db/migrate.ts` keeps its shape and
gains hash tracking and the reset path (D10); `src/db/migrations.ts` keeps its
`import.meta.glob` loader with the path moved to `src/db/sql/`.

## Out of scope

Ingest (file discovery, parsing, the CSV↔perf join, idempotency, batching), the client API,
UI, and any retention policy for old perf series. Retention in particular is deliberately
deferred: the series is 21 MB at the 10,000-run target, and dropping `run_series` rows later
requires no schema change.

## Risks

- **`run_progress` misuse.** Filtering it on a non-partition column silently scans the whole
  history. Mitigated by a comment on the view and by the rule above; it cannot be enforced.
- **The `config` dimension under Random Sensitivity.** Degrades to one row per run, which
  costs what inlining would have cost — bounded, but the 47× win disappears (D4).
- **Arrays are unconventional.** Drizzle cannot express the alignment checks or the `unnest`
  views, so those live in hand-written SQL. Mitigated by the views being the only query
  surface, which makes the choice reversible (D5).
- **Midnight rollover** remains unsolved, as `ingest.md` records. This schema confines it to
  the `kill` view's `t_offset` and to ingest's date attachment, rather than spreading it.
- **`smallint` identity columns** for `bot`, `weapon` and `game_version` cap at 32767. Bot
  and weapon are bounded by KovaaK's content (124 and 18 observed); game version grows by a
  handful per year from 16. `kill_series.shots` and `.hits` are also `smallint[]`, against a
  measured maximum of 2833 shots on a single kill (a 28.3 s TTK on a tracking weapon) —
  11× headroom, which is thinner than the others and the likeliest of these to need
  widening.
- **`tick_no` used as a cross-run key.** The cadence is not uniform, and 17 of 284 scenarios
  spread ≥2 s at a common tick index. Mitigated by bucketing on elapsed time in the worked
  query and by the note there, but nothing stops a future query from joining on `tick_no`.
- **`run_series.t` monotonicity is an ingest obligation, not a constraint.** A `CHECK`
  cannot contain a subquery, so enforcing it needs an `IMMUTABLE` helper function. Measured
  0 violations in 2164 files; a violation would silently corrupt every cumulative curve.
- **The abort branch rests on n=1.** `run_kind` is a closed two-value enum, and the third
  classification branch is defined purely by empty scenario identity — observed in exactly
  one file. `ingest.md`'s Known gaps does not establish that every "player leaves a paused
  scenario" file has empty identity. One that does not would be classified `complete`, with
  the stale `Challenge Start` that implies: either a bogus run on the performance axis, or
  a `complete_ends_after_start` violation. The constraint at least makes the second case
  loud.

## Appendix: measurements

All against `test/fixtures/raw/` (2496 CSVs, 2164 perfs) under PGlite 0.5.8 / PostgreSQL
18.3 on 2026-09-18. "@10k" scales by run count.

Cardinality:

| | |
| --- | ---: |
| CSVs with scenario identity | 2495 |
| distinct scenarios / hashes | 316 / 316 |
| **distinct settings combinations** | **53** |
| game versions / sens scales / resolutions | 16 / 3 / 1 |
| kill rows (files with any / max per file) | 75,504 (1343 / 204) |
| distinct bot instances / weapons | 124 / 18 |
| (run, bot) pairs | 3111 |
| runs per scenario | median 3, max 116 |
| perf events → **distinct ticks** | 815,361 → **132,913** |
| duplicate `(timestamp, event type)` within a file | **0 of 815,361** |
| ticks per file | median 60, max 125 |

Storage, and the layouts that were rejected:

| layout | corpus | @10k | verdict |
| --- | ---: | ---: | --- |
| perf, one row per event | 59.3 MB | 274 MB | rejected |
| perf, one row per tick | 13.1 MB | 60 MB | rejected |
| **perf, per-run arrays** | **4.5 MB** | **21 MB** | chosen |
| perf, raw `bytea` | 5.8 MB | 27 MB | rejected — dearer than decoded, and unqueryable |
| kills, one row per kill | 8.5 MB | 34 MB | rejected |
| **kills, per-run arrays** | **1.8 MB** | **7.3 MB** | chosen |
| `run_bot` rollup | 0.43 MB | 1.7 MB | chosen |
| `run` + dimensions + `run_weapon` | 1.7 MB | 7.3 MB | |
| **total** | | **~37 MB** | |

Query cost (corpus scale unless noted):

| query | cost |
| --- | ---: |
| run + PB before it | 2.8 ms |
| one scenario's n/mean/p50/p90/best | 1.5 ms |
| all 316 scenarios' p50/p90/best | 13.3 ms |
| bot breakdown, from `run_bot` / kill rows / kill arrays | 2.4 / 3.1 / 4.5 ms |
| PB timeline for a scenario | 2.5 ms |
| session segmentation, whole history | 3.7 ms |
| tick curve band, 116-run scenario (ticks / arrays) | 24.5 / 30.8 ms |
| whole-corpus tick scan (ticks / arrays) | 43 / 147 ms |
| `span @> timestamptz` containment, 2500 runs | 0.9 ms, index scan |
| `run_progress` filtered by partition key, 100k rows | 5.2 ms, 334 rows touched |

### Review corrections

This spec was reviewed against the format docs and the raw corpus after the first draft.
What that found, all since fixed above, and all confirmed independently:

| finding | measurement |
| --- | --- |
| `span @> challenge_start_utc` — the spec's encoding of the CSV↔perf join — matches nothing, because `span` lacks the 1000 ms of lower-bound slack `ingest.md` specifies | `challenge_start_utc >= started_at` in 4 of 2156 pairs |
| `Cheated` is not identically zero, so the prescribed "ingest raises" would hard-fail on a file already in the fixtures | 1 of 75,504 kill rows |
| Nulling `Score` on every reset destroys real accumulator values | non-zero in 16 of 21 resets |
| Interning bot names verbatim forks one bot into two dimension rows | `" speedswitch "` in 520 rows, `"speedswitch"` in 508, alternating within one file |
| `tick_no` is not a cross-run clock | 17 of 284 scenarios spread ≥2 s at a common tick index; 56 have runs of differing tick counts |
| `run_progress.attempt_no` counted completions, not attempts, so the reroll confound could not be attached to a run | renamed `completion_no`; `run_attempt` added |
| `has_perf` was a denormalised boolean nothing kept true | replaced by a left join in `run_complete` |
| Four holes in the migration reset rules (hash bootstrap, CRLF sensitivity, non-atomic bookkeeping, reordering) | see D10 |
| `shots = hit_count + miss_count` was an unenforced free invariant | holds in 2495/2495 |

### Execution

The DDL in this document was executed against PGlite 0.5.8, and every constraint, view and
worked query above was exercised against it: the `kind`/`started_at` checks reject a reset
carrying a start time, the exclusion constraint rejects an overlapping complete run,
`kill_series` and `run_series` reject misaligned arrays, the 14-array `tick` view returns
`NULL` rather than `0` for a metric the run never emitted, `run_progress` filtered by
`scenario_id` plans as an index scan on `run_scenario_time`, the statement trigger emits one
notification per batch, and deleting a run cascades to all three detail tables. Two defects
were found and fixed this way: a `t_offset` expression that depended on the session
timezone, and a `run_session` view that nested a window function inside a `PARTITION BY`.

Feature verification in PGlite 0.5.8: virtual and stored generated columns ✅; `EXCLUDE
USING gist` on a generated `tstzrange`, rejecting overlap and accepting partials ✅; that
index serving `@>` lookups ✅; multi-array `unnest … WITH ORDINALITY` ✅; cardinality
`CHECK` rejecting misaligned arrays ✅; statement-level trigger with a transition table
driving `pg_notify` + `pg.listen` ✅; `live.query` and `live.incrementalQuery` over a view
with window functions ✅; `DROP SCHEMA public CASCADE` + recreate ✅; `btree_gist` only
after loading the contrib module explicitly — not needed by this schema, since the
exclusion constraint uses a pure range operator class.
