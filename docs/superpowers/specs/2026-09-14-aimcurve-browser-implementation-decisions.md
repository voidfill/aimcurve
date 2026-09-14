# Browser port — implementation decisions

Date: 2026-09-14. An addendum, not a design. The design is
[the read-only browser app](2026-09-13-aimcurve-browser-design.md), and this
document settles only what that one left open or what has since been decided
differently. Where the two disagree, this one wins and says so.

Scope is **step one only**.
[Live updates](2026-09-13-aimcurve-live-updates-design.md) and
[reaching the install](2026-09-13-aimcurve-reaching-the-install.md) are not
built here. The source boundary and the incremental index path are built to the
shape step two needs, which is what that document asked for.

## Deviations from the browser design

Four, all deliberate, recorded here so the difference is not read later as
drift.

**The Python retires as a tool.** `server.py` and `watch.py` are deleted along
with `aimcurve/web/`. What remains is the oracle: `paths`, `statscsv`, `perf`,
`shapes`, `compare`, `index`, plus a new `dump` command. The browser design
wanted the Python kept live on the grounds that it is "the only live option for
anyone who has Python and will not modify their install." That is given up. The
cost is real and lands on exactly that group; it is accepted rather than
mitigated.

**Dependencies and a build step now exist.** The original design's "no npm, no
bundler, everything vendored" is superseded for the browser app. The reasoning
that retired it: those constraints were about what the *user* must install, and
a static build does not reach the user. The deployed artefact is still a
directory of static files with no runtime dependency and no server, so the
promise the README makes is unchanged. The promise the repository made to
itself is not.

**`run.id` is the run's basename.** A string —
`Air Pure Medium - Challenge - 2026.09.12-16.04.49` — not a number. The browser
design already required an id derived from the basename; this fixes which
derivation. It is stable across machines, across re-picks and across a dropped
database, it cannot collide, and it is legible in a URL and in a console. The
costs are that `app.js` routes on `/^\d+$/` today (`app.js:117`) and must be
patched to accept an encoded string, and that the oracle diff cannot compare
`id` directly, because the Python's is a row counter. The diff normalises it
out.

**`scripts/drive-client.mjs` is deleted.** It is `fetch()` against `:8777` and
an `EventSource` stub, and there will be no server to reach. The browser design
listed replacing it as an open question; the answer is that its coverage — rail
paging, the marks, run-time formatting — moves into payload-builder tests that
run over the same fixtures with no server and no browser at all.

## The module boundary

This is the load-bearing decision, and it is what makes the verification story
work rather than a matter of discipline.

```
web/src/core/     pure TypeScript. No DOM, no IndexedDB, no File.
web/src/db/       IndexedDB: schema, incremental indexer, writer election
web/src/source/   the source boundary: FileList and FileSystemDirectoryHandle
web/src/ui/       app.js near-verbatim, style.css, vendored uPlot
```

`core/payload.ts` is the port of `server.py`'s payload builder, which the design
correctly identifies as the bulk of the work. **It never sees IndexedDB.** It
reads through a `Store` interface with two implementations: an in-memory one
built directly from parsed files, and the IndexedDB one. The in-memory store is
not a test double — it is how the oracle diff runs, and it is a real product
path for a bootstrap that has not been written yet.

```ts
interface Store {
  getRun(id: string): Run | undefined;
  getScenario(name: string): Scenario | undefined;
  getCurve(id: string): Curve | undefined;      // 7 Float32Arrays
  getKills(id: string): Kill[];
  candidates(id: string, opts: CandidateOpts): Run[];
  page(limit: number, opts: PageOpts): RailRow[];
  bestBySlot(ids: string[], metric: "ttk" | "share"): Map<number, number>;
  scenarioList(): ScenarioRow[];
  day(iso: string): Run[];
}
```

`bestBySlot` takes a named metric rather than `server.py`'s SQL expression
string and a direction (`_best_by_slot`, `server.py:271`). There are exactly two
callers — minimum TTK for race splits, maximum damage share for bot windows —
and passing an expression to be interpolated into a query is a habit worth
leaving behind with the SQL.

**Marks materialisation is a pure function in `core/`, not a write-path
detail.** `marks.ts` takes runs sorted by `started_at` plus the scenario shapes
and returns `best_before` / `played_before` for each, in both the `same_cfg` and
relaxed variants. Both the in-memory builder and the IndexedDB indexer call it.
The alternative — computing in one and materialising in the other — would mean
the node tests exercise code that never ships, and the design's 70× measurement
(4.2 ms against 296 ms) depends on the materialised path being the one that
runs.

## Toolchain

Astro with TypeScript, which is Vite underneath. Chosen because it is a static
site generator whose default output carries no framework runtime, so `app.js`
stays vanilla and is not rewritten. A framework rewrite is expected later and is
explicitly not this work.

- `astro build` → static `dist/`, deployable to Pages.
- Vitest for tests, sharing the Vite config.
- `fake-indexeddb` is a dev dependency, used in Plan B for the two indexer
  cases a real install cannot be made to produce on demand — an out-of-order
  insert and a scenario whose shape flips — and for nothing else. It is not the
  primary verification route; see below.
- New code is TypeScript. `app.js` moves as `.js` under `allowJs` and is
  converted separately, later, if at all.

## Verification

The browser design's exit criterion — a full-corpus oracle diff against a real
install — stands and is unchanged. It cannot run on the development machine,
which has no KovaaK's install and no stats files. That splits verification in
two, and the split is the reason for the plan ordering below.

**What runs here, automated, on the committed fixtures:** the parsers, the
shape classifier, the compare math, the marks materialisation, and the whole
payload builder, through the in-memory store. Plus the oracle diff at fixture
scale: `python -m aimcurve dump` against the same fixtures, JSON against JSON.

The Python oracle gains one command and nothing else:

```
python -m aimcurve dump --root <dir> --out <path>
```

It indexes `<dir>/stats` and `<dir>/performances` into a temporary database and
writes every API payload — every run, the rail, the scenario list, each day —
as one JSON document. `tests/fixtures/` is already exactly that layout, so
`--root tests/fixtures` works with no fixture rearrangement.

**What does not run here:** the IndexedDB adapter, both sources, the UI, and the
full-corpus diff. These are checked by integration testing on a machine with the
game installed. Writing automated tests for them on a machine that cannot
exercise them would report green over nothing, which is the failure mode the
README already names.

Two traps from the design stay encoded in the port and are asserted directly,
not transitively: a `.perf` metric is omitted for any second in which it was
zero, so sample order is not time order; and within a sample, integer series are
varints while float series are fixed32, so a decoder that reads only fixed32
parses cleanly and silently returns zeros for four of the seven series.

One known divergence to watch, flagged by the design and not yet resolved:
Python's `round()` is banker's rounding and JavaScript's is not, and `cfg_key` is
`round(cm360, 1)`. A one-ulp disagreement changes which runs are comparable.
The fixture diff may not contain a value that lands on a tie; the full-corpus
diff is what settles it.

## Plan ordering

Two plans, split where the verification story splits.

**Plan A — the engine.** Scaffold, `core/` in full, the in-memory store, the
Python `dump` command, the diff harness. Exit criterion: payloads agree with the
frozen Python over all 11 stats fixtures and 7 `.perf` fixtures, `id` normalised
out. Entirely achievable without a KovaaK's install.

**Plan B — storage and the app.** IndexedDB schema and the packed-kills layout,
the incremental index path, `navigator.storage.persist()`, Web Locks writer
election, the two sources, `app.js` wired to an in-process `api()` shim, and the
staleness UI. Exit criterion: an integration pass on a machine with the game
installed.

Plan B depends on Plan A having produced a `Store` that IndexedDB can satisfy
without the payload builder noticing. If that boundary holds, Plan B writes no
comparison logic at all.

## Still open

- **How loudly to report staleness.** Carried over from the browser design,
  still a UI decision, and it belongs to Plan B.
- **Whether `app.js` becomes TypeScript.** Deferred. It works, and converting it
  inside a port would mix two kinds of risk.
- **The banker's-rounding divergence**, above, until the full-corpus diff runs.
