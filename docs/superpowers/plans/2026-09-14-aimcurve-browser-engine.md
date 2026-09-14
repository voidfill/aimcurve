# aimcurve Browser Engine Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port aimcurve's parsing, classification, comparison and payload-building from Python to TypeScript, verified against the frozen Python as an oracle over the committed fixtures — with no IndexedDB, no browser and no KovaaK's install involved.

**Architecture:** A pure `web/src/core/` that never touches storage, the DOM or `File`. It reads through a `Store` interface with one implementation in this plan — an in-memory store built directly from parsed files. `core/payload.ts` is a faithful port of `aimcurve/server.py`'s payload builder. The Python gains a `dump` command that emits the same payloads as JSON, and a diff harness compares the two.

**Tech Stack:** Astro 5 (static output, no framework runtime) with TypeScript strict; Vitest for tests; Node 22. Python 3 stdlib only for the oracle — on this machine Python is reached with `nix shell nixpkgs#python3 --command`.

**Spec:** `docs/superpowers/specs/2026-09-14-aimcurve-browser-implementation-decisions.md`, which amends `docs/superpowers/specs/2026-09-13-aimcurve-browser-design.md`.

---

## Global Constraints

- **Plan A is purely additive.** Nothing is deleted. `server.py`, `watch.py` and `scripts/drive-client.mjs` keep working for the whole of this plan, so `python -m aimcurve` still runs at every commit. Deletion happens at the end of Plan B.
- **`web/src/core/` imports nothing from `web/src/db/`, `web/src/source/`, `web/src/ui/`, the DOM, or Node's `fs`.** Tests may read `fs`; the modules under test may not. This is the property that makes the whole verification story work — if it is broken, the oracle diff stops proving anything about what ships.
- **The Python is the oracle, not a sketch.** Where behaviour is ambiguous, the Python's behaviour is the answer, including its quirks. Port the comments too: each one records a trap, and a port that drops them re-learns them.
- **The invariant:** a cumulative-delta curve's final value equals the score difference exactly. It is asserted on both the timed path (exactly) and the race path (to ±0.02 s, which is the CSV's timestamp resolution — see `compare.py:139-151`).
- **Floats are compared with a tolerance, not byte-identically.** `statistics.fmean`, `pstdev` and `median` use `math.fsum` internally, which is exactly rounded; naive JS summation is not. The diff harness uses a relative tolerance of `1e-12` (absolute `1e-9` near zero) for floats and exact equality for everything else. This is a deliberate relaxation of the browser design's "byte-identical" wording; see Task 17.
- **`Float32Array` and Python's `array('f')` are the same IEEE-754 binary32.** Curve values must agree exactly, with no tolerance. A tolerance hiding a curve disagreement would hide exactly the class of bug this port is most likely to have.
- **Test style:** Vitest, one `describe` per module, assertions against the real fixtures in `tests/fixtures/`. Every expected value in this plan was produced by running the Python against those fixtures on 2026-09-14 — do not change an expected value to make a test pass.
- **Commit after every task.** Message style matches the repository: imperative subject, a body explaining why rather than what.

## Run ids

`id` is the stats basename with `" Stats.csv"` removed:

```
Air Pure Medium - Challenge - 2026.09.12-16.04.49
```

The eleven fixture runs therefore have these ids, and the Python row ids they correspond to (needed by the diff harness):

| Python `id` | `id` in TypeScript |
|---|---|
| 1 | `1w2ts Pasu Perfected Easy - Challenge - 2025.12.29-22.57.12` |
| 2 | `Air Pure Medium - Challenge - 2026.09.03-19.08.37` |
| 3 | `Air Pure Medium - Challenge - 2026.09.12-16.04.49` |
| 4 | `Air Spectral Easy - Challenge - 2026.09.05-08.20.43` |
| 5 | `Air Spectral Easy - Challenge - 2026.09.11-18.37.39` |
| 6 | `Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33` |
| 7 | `Happy Easter! - Challenge - 2026.04.06-18.13.05` |
| 8 | `Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01` |
| 9 | `VT 1w2ts Horizontal Small - Challenge - 2026.06.22-18.48.41` |
| 10 | `VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47` |
| 11 | `VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09` |

## What the fixture corpus exercises

Confirmed by running the Python over `tests/fixtures/` on 2026-09-14. Every branch below has a fixture, which is why this plan can reach its exit criterion without a game install.

| Case | Fixture |
|---|---|
| Race, classified from a `.perf` countdown | `Air Pure Medium` (2 runs, both with `.perf`) |
| Race, classified from CSV totals only (tier 2) | `Air Spectral Easy` (2 runs, no `.perf` at all) |
| Timed, windowed (fixed TTK slots, invincible bots) | `VT Ground Intermediate S5` (2 runs, `windowed=1`, `bots=3`) |
| Timed, penalising (negative score buckets) | `VT 1w2ts Horizontal Small` |
| Timed, pure tracking, zero kill rows | `Air Voltaic Invincible 4 Medium` |
| Clicking, with reloads | `Pasu Voltaic Reload Easier` |
| `Sens Scale` that is not cm/360 | `1w2ts Pasu Perfected Easy` (The FINALS) |
| Kill rows whose `Kill #` column is 0 on every row | `Happy Easter!` |
| Truncated `.perf` | `tests/fixtures/truncated - ... Performance.perf` |
| Scenario with one run and no baseline | `Happy Easter!`, `1w2ts Pasu Perfected Easy` |

Not covered by any fixture, and therefore not provable here: non-ASCII scenario names, a malformed CSV, a scenario whose PB has no `.perf` while another run does, and the banker's-rounding tie on `cfg_key`. These wait for the full-corpus diff on a real install.

## File Structure

```
aimcurve/payload.py          NEW  payload builder, moved out of server.py
aimcurve/dump.py             NEW  index a folder, emit every payload as JSON
aimcurve/__main__.py         MOD  `dump` subcommand alongside the default serve
aimcurve/server.py           MOD  imports the payload builder rather than defining it
tests/test_dump.py           NEW

web/package.json             NEW
web/astro.config.mjs         NEW
web/tsconfig.json            NEW
web/vitest.config.ts         NEW
web/.gitignore               NEW
web/src/pages/index.astro    NEW  placeholder shell; Plan B fills it

web/src/core/types.ts        Run, Kill, Curve, Scenario, RailRow, Payload
web/src/core/statscsv.ts     parseFilename, cm360, parseSummary, parseKills
web/src/core/perf.ts         protobuf wire walker -> dense Float32Array grid
web/src/core/shapes.ts       countdownBudget, budgetFromTotals, fixedWindows, classify
web/src/core/scenario.ts     refreshScenario: the per-scenario fold
web/src/core/compare.ts      smooth, pad, cumulativeDelta, band, resampleRace, raceDelta
web/src/core/marks.ts        materialiseMarks: best_before / played_before
web/src/core/store.ts        the Store interface
web/src/core/memstore.ts     in-memory Store + buildStore()
web/src/core/baselines.ts    candidates, baselines
web/src/core/payload.ts      buildRunPayload and its two fill paths
web/src/core/api.ts          the five endpoint functions app.js calls

web/test/fixtures.ts         locates and reads tests/fixtures/
web/test/*.test.ts           one file per core module
web/tools/oracle-diff.mjs    Python JSON vs TypeScript JSON
```

## Review checkpoints

Stop for review after **Task 2**, **Task 7**, **Task 12**, **Task 16** and **Task 17**. Everything else runs straight through.

---

### Task 1: Move the payload builder out of server.py

`server.py` is about to be deleted, and its payload builder is the oracle. Moving it first means the oracle exists as an importable module before anything depends on it, and the move is verifiable on its own: the Python test suite must stay green across it.

**Files:**
- Create: `aimcurve/payload.py`
- Modify: `aimcurve/server.py`
- Modify: `tests/test_server.py`

- [ ] **Step 1: Create `aimcurve/payload.py` by moving code verbatim from `server.py`**

Move these, unchanged, including every comment and docstring: `METRICS`, `_ratio`, `_series`, `_usable_metrics`, `build_run_payload`, `_fill_timed`, `_fill_race`, `_peer_ids`, `_best_by_slot`, `_share`, `_window_summary`, `_race_splits`, `_bot_windows`, `RUN_LIST_COLUMNS`, `run_list`, `_rows`.

That is `server.py:52-87` and `server.py:90-438`. The new file's header:

```python
"""Building the JSON payloads the dashboard reads.

This is the reference implementation. The browser port in `web/src/core/` is
checked against it file by file, so behaviour here is a contract rather than an
implementation detail -- including the parts that look like quirks.
"""

import json  # noqa: F401  (kept for callers that re-export)

from . import compare, index, shapes
```

Drop the unused `json` import if `payload.py` does not in fact use it; check before committing.

- [ ] **Step 2: Reduce `server.py` to the HTTP surface**

Delete the moved definitions from `server.py` and change its import line to:

```python
from . import index, payload, watch
```

Then in `do_GET`, replace the two call sites:

- `run_list(conn, limit, ...)` becomes `payload.run_list(conn, limit, ...)`
- `build_run_payload(conn, run_id, ...)` becomes `payload.build_run_payload(conn, run_id, ...)`
- `_rows(conn, ...)` becomes `payload._rows(conn, ...)`

`compare` and `shapes` are no longer referenced from `server.py`; remove them from the import. `SQLITE_INT_MAX`, `MAX_LIMIT` and `_bounded_int` stay in `server.py` — they are HTTP input validation, not payload construction.

- [ ] **Step 3: Point the tests at the new module**

In `tests/test_server.py`, add `payload` to the `from aimcurve import ...` line and rewrite every direct call. The tests that exercise `server.build_run_payload` or `server.run_list` become `payload.build_run_payload` / `payload.run_list`. Tests that go through HTTP are untouched.

- [ ] **Step 4: Run the Python suite**

Run: `nix shell nixpkgs#python3 --command python3 -m unittest discover -s tests`
Expected: OK, same test count as before the move. If a test fails, the move was not verbatim — find the edit rather than adjusting the test.

- [ ] **Step 5: Commit**

```bash
git add aimcurve/payload.py aimcurve/server.py tests/test_server.py
git commit -m "Move the payload builder out of the HTTP layer

It is about to become the oracle the browser port is checked against, and an
oracle that can only be reached by starting a server is one the diff harness
would have to run a server to consult. No behaviour changes."
```

---

### Task 2: The `dump` command

**Files:**
- Create: `aimcurve/dump.py`
- Modify: `aimcurve/__main__.py`
- Test: `tests/test_dump.py`

**Interfaces:**
- Consumes: `payload.build_run_payload`, `payload.run_list` from Task 1.
- Produces: `dump.build(conn) -> dict` and `python -m aimcurve dump --root DIR --out FILE`.

The output document is the whole API surface at once, keyed so the diff harness can walk it without a second index pass:

```json
{
  "runs":      { "<python id>": { "...payload..." } },
  "rail":      [ { "...rail row..." } ],
  "scenarios": [ { "...scenario row..." } ],
  "days":      { "2026-09-12": [ { "...session row..." } ] },
  "ids":       { "<python id>": "<basename id>" }
}
```

`ids` is what lets the harness map Python's row counters onto basenames without re-deriving them.

- [ ] **Step 1: Write the failing test**

Create `tests/test_dump.py`:

```python
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from aimcurve import dump, index, paths  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


class DumpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cfg = paths.load({"KOVAAKS_DIR": FIXTURES,
                          "AIMCURVE_DB": os.path.join(cls.tmp.name, "i.sqlite3")})
        conn = index.connect(cfg.db_path)
        index.bootstrap(conn, cfg)
        cls.doc = dump.build(conn)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_every_run_has_a_payload(self):
        self.assertEqual(len(self.doc["runs"]), 11)

    def test_ids_map_to_basenames(self):
        self.assertEqual(
            self.doc["ids"]["3"],
            "Air Pure Medium - Challenge - 2026.09.12-16.04.49")

    def test_race_payload_carries_its_shape(self):
        payload = self.doc["runs"]["3"]
        self.assertEqual(payload["scenario"]["shape"], "race")
        self.assertEqual(payload["axis"]["n"], 200)
        self.assertAlmostEqual(payload["delta"]["final"], 7.855, places=3)

    def test_rail_is_newest_first_and_complete(self):
        self.assertEqual(len(self.doc["rail"]), 11)
        self.assertEqual(self.doc["rail"][0]["id"], 3)

    def test_days_are_keyed_by_date(self):
        self.assertIn("2026-09-12", self.doc["days"])
        self.assertEqual(len(self.doc["days"]["2026-09-12"]), 1)

    def test_document_is_json_serialisable(self):
        json.dumps(self.doc, default=float)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `nix shell nixpkgs#python3 --command python3 -m unittest tests.test_dump -v`
Expected: `ModuleNotFoundError: No module named 'aimcurve.dump'`

- [ ] **Step 3: Write `aimcurve/dump.py`**

```python
"""Emitting every API payload for a folder of runs, as one JSON document.

This exists so the browser port can be diffed against this implementation
without either side running a server. It is the whole API surface in one file:
every run's payload, the rail, the scenario list and each day's session view.

`ids` maps this database's row counters onto run basenames. The browser keys on
the basename -- a row counter does not survive a machine, let alone a re-pick --
so the harness needs the correspondence spelled out rather than inferred.
"""

import argparse
import json
import os
import sys
import tempfile

from . import index, paths, payload

# Matches server.py's /api/runs default ceiling closely enough for a dump: the
# point is "all of them", and a real install is far below this.
ALL = 100_000


def _basename_id(stats_file):
    base = os.path.basename(stats_file)
    return base[: -len(" Stats.csv")] if base.endswith(" Stats.csv") else base


def build(conn):
    """-> the whole API surface for this database."""
    runs = {}
    ids = {}
    for row in conn.execute("SELECT id, stats_file FROM run ORDER BY id"):
        runs[str(row["id"])] = payload.build_run_payload(conn, row["id"])
        ids[str(row["id"])] = _basename_id(row["stats_file"])

    scenarios = payload._rows(conn, """
        SELECT s.scenario, COUNT(*) AS runs, MAX(s.score) AS pb,
               MAX(s.started_at) AS last_played,
               (SELECT shape FROM scenario WHERE name = s.scenario) AS shape,
               (SELECT elapsed_s FROM run r WHERE r.scenario = s.scenario
                 ORDER BY r.score DESC LIMIT 1) AS pb_elapsed,
               (SELECT AVG(elapsed_s) FROM (
                    SELECT elapsed_s FROM run r WHERE r.scenario = s.scenario
                    ORDER BY started_at DESC LIMIT 10)) AS recent_elapsed,
               (SELECT AVG(score) FROM (
                    SELECT score FROM run r WHERE r.scenario = s.scenario
                    ORDER BY started_at DESC LIMIT 10)) AS recent_form
        FROM run s GROUP BY s.scenario ORDER BY last_played DESC""")

    days = {}
    for (day,) in conn.execute(
            "SELECT DISTINCT substr(started_at,1,10) FROM run ORDER BY 1"):
        days[day] = payload._rows(
            conn,
            "SELECT id, scenario, started_at, score, accuracy, spm "
            "FROM run WHERE substr(started_at,1,10)=? ORDER BY started_at",
            (day,))

    return {
        "runs": runs,
        "rail": payload.run_list(conn, ALL),
        "scenarios": scenarios,
        "days": days,
        "ids": ids,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(prog="aimcurve dump")
    parser.add_argument("--root", required=True,
                        help="a folder containing stats/ and performances/")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    # A throwaway database every time. A dump that reused a cache could report
    # a schema from a previous version of the code, which is precisely the
    # failure an oracle must not have.
    with tempfile.TemporaryDirectory() as tmp:
        cfg = paths.load({"KOVAAKS_DIR": args.root,
                          "AIMCURVE_DB": os.path.join(tmp, "dump.sqlite3")})
        conn = index.connect(cfg.db_path)
        counts = index.bootstrap(conn, cfg)
        document = build(conn)

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(document, handle, default=float, sort_keys=True, indent=1)
    print(f"{counts['runs']} runs, {counts['curves']} curves -> {args.out}",
          file=sys.stderr)
    return 0
```

- [ ] **Step 4: Wire the subcommand**

Replace `aimcurve/__main__.py` entirely:

```python
"""python -m aimcurve [--port N] | python -m aimcurve dump --root DIR --out FILE"""

import argparse
import sys

from . import dump, paths, server


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "dump":
        return dump.main(argv[1:])

    parser = argparse.ArgumentParser(prog="aimcurve")
    parser.add_argument("--port", type=int, default=8777)
    args = parser.parse_args(argv)
    try:
        cfg = paths.load()
    except paths.Fail as error:
        print(error, file=sys.stderr)
        return error.code
    server.serve(cfg, args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run the tests**

Run: `nix shell nixpkgs#python3 --command python3 -m unittest discover -s tests`
Expected: OK. The whole suite, not just `test_dump` — Task 1's move must still hold.

- [ ] **Step 6: Verify the command end to end**

Run: `nix shell nixpkgs#python3 --command python3 -m aimcurve dump --root tests/fixtures --out /tmp/oracle.json`
Expected on stderr: `11 runs, 7 curves -> /tmp/oracle.json`

- [ ] **Step 7: Commit**

```bash
git add aimcurve/dump.py aimcurve/__main__.py tests/test_dump.py
git commit -m "Add a dump command that emits every payload as JSON

The browser port needs something to be checked against, and starting an HTTP
server to ask it questions is a worse fixture than a file. Indexes into a
throwaway database so a dump can never report a stale schema."
```

**REVIEW CHECKPOINT — stop here.** The oracle now exists and is reproducible. Confirm `/tmp/oracle.json` contains 11 runs before the port begins.

---

### Task 3: Scaffold the Astro app and the test harness

**Files:**
- Create: `web/package.json`, `web/astro.config.mjs`, `web/tsconfig.json`, `web/vitest.config.ts`, `web/.gitignore`, `web/src/pages/index.astro`
- Create: `web/test/fixtures.ts`, `web/test/scaffold.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Create the Astro project**

Run from the repository root:

```bash
mkdir -p web && cd web
npm create astro@latest -- --template minimal --typescript strict --no-install --no-git --skip-houston .
npm install
npm install -D vitest
```

Astro's minimal template writes `package.json`, `astro.config.mjs`, `tsconfig.json`, `src/pages/index.astro` and `public/`. Keep them; the steps below adjust three.

- [ ] **Step 2: Configure static output and the base path**

Replace `web/astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';

// Static output with no framework runtime: the deployed artefact is a folder of
// files that any static host serves, which is the one promise from the original
// design that survived allowing a build step at all.
export default defineConfig({
  output: 'static',
  // Set `site` and `base` when the Pages origin is known. Left unset so `astro
  // dev` and `astro build` both work from a bare checkout.
  vite: {
    // uPlot is vendored and ships as a UMD bundle; Vite must not try to
    // pre-bundle it as an ES module.
    optimizeDeps: { exclude: ['uplot'] },
  },
});
```

- [ ] **Step 3: Add the Vitest config**

Create `web/vitest.config.ts`:

```ts
import { getViteConfig } from 'astro/config';

// getViteConfig rather than a standalone vitest config: it inherits the path
// aliases and TypeScript settings Astro resolves, so a module imported in a
// test resolves exactly as it will in the browser.
export default getViteConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The fixtures are read from disk, so these are not browser tests.
    environment: 'node',
  },
});
```

- [ ] **Step 4: Add the test scripts**

In `web/package.json`, set the `scripts` block to:

```json
{
  "dev": "astro dev",
  "build": "astro build",
  "preview": "astro preview",
  "check": "astro check",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Ignore build output**

Create `web/.gitignore`:

```
node_modules/
dist/
.astro/
```

- [ ] **Step 6: Write the fixture helper**

Create `web/test/fixtures.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The fixtures live with the Python, one level up, because both implementations
// are checked against the same files. See the repository-split spec: there is
// no boundary here to reach across.
export const FIXTURES = new URL('../../tests/fixtures/', import.meta.url).pathname;

export const statsDir = join(FIXTURES, 'stats');
export const perfDir = join(FIXTURES, 'performances');

/** Every stats basename, without the " Stats.csv" suffix. */
export function statsIds(): string[] {
  return readdirSync(statsDir)
    .filter((n) => n.endsWith(' Stats.csv'))
    .map((n) => n.slice(0, -' Stats.csv'.length))
    .sort();
}

export function readStats(id: string): string {
  return readFileSync(join(statsDir, `${id} Stats.csv`), 'utf8');
}

/** The `.perf` bytes for a run, or undefined for the ~1-in-7 that have none. */
export function readPerf(id: string): Uint8Array | undefined {
  try {
    return new Uint8Array(readFileSync(join(perfDir, `${id} Performance.perf`)));
  } catch {
    return undefined;
  }
}

/** The truncated fixture, which lives outside performances/ so no bootstrap
 *  picks it up as a real run. */
export function readTruncatedPerf(): Uint8Array {
  return new Uint8Array(
    readFileSync(join(FIXTURES, 'truncated - Challenge - 2026.01.01-00.00.00 Performance.perf')));
}
```

- [ ] **Step 7: Write a scaffold test**

Create `web/test/scaffold.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readPerf, readStats, statsIds } from './fixtures';

describe('fixtures', () => {
  it('finds all eleven stats files', () => {
    expect(statsIds()).toHaveLength(11);
  });

  it('reads a stats file as text', () => {
    const text = readStats('Air Pure Medium - Challenge - 2026.09.12-16.04.49');
    expect(text).toContain('Scenario:,Air Pure Medium');
  });

  it('reads a perf file as bytes', () => {
    const bytes = readPerf('Air Pure Medium - Challenge - 2026.09.12-16.04.49');
    expect(bytes!.byteLength).toBeGreaterThan(1000);
  });

  it('reports a missing perf as undefined rather than throwing', () => {
    expect(readPerf('Air Spectral Easy - Challenge - 2026.09.11-18.37.39')).toBeUndefined();
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `cd web && npm test`
Expected: 4 passed.

- [ ] **Step 9: Commit**

```bash
git add web .gitignore
git commit -m "Scaffold the browser app

Astro for static output with no framework runtime, so app.js stays vanilla when
it moves over. Vitest through getViteConfig so a module resolves in a test
exactly as it will in the browser. The fixture helper reads the same files the
Python tests do -- both implementations are checked against one corpus."
```

---

### Task 4: Core types

**Files:**
- Create: `web/src/core/types.ts`
- Test: none. Types are checked by `astro check`, not by assertions.

- [ ] **Step 1: Write the types**

```ts
/** The shapes every other core module speaks in.
 *
 * These mirror the Python's `run`, `curve`, `kill` and `scenario` tables, with
 * two deliberate differences: `id` is the run's basename rather than a row
 * counter, and there is no `stats_file` or `perf_file` because the browser has
 * no absolute paths. `has_perf` carries what those columns were actually used
 * for -- whether this run can supply a curve.
 */

export const SERIES = [
  'shots', 'hits', 'misses', 'dmg_done', 'dmg_possible', 'score', 'kills',
] as const;
export type SeriesName = (typeof SERIES)[number];

export type Series = Record<SeriesName, Float32Array>;

export interface Curve {
  buckets: number;
  duration_s: number;
  series: Series;
}

export interface PerfHeader {
  scenario: string | null;
  hash: string | null;
  started_ms: number | null;
}

export type Shape = 'timed' | 'race';

export interface Run {
  id: string;
  scenario: string;
  started_at: string;
  has_perf: boolean;

  score: number | null;
  kills: number | null;
  hits: number | null;
  misses: number | null;
  shots: number | null;
  accuracy: number | null;
  damage_done: number | null;
  damage_possible: number | null;
  avg_ttk: number | null;
  fight_time: number | null;
  pause_count: number | null;

  duration_s: number | null;
  spm: number | null;
  elapsed_s: number | null;
  overshots: number | null;
  reloads: number | null;
  damage_taken: number | null;

  hash: string | null;
  game_version: string | null;
  sens_raw: number | null;
  sens_scale: string | null;
  dpi: number | null;
  sens_increment: number | null;
  cm360: number | null;
  cfg_key: string | null;
  fov: number | null;
  fov_scale: string | null;
  resolution: string | null;
  avg_fps: number | null;
}

export interface Kill {
  idx: number;
  t: number;
  bot: string;
  weapon: string;
  ttk: number | null;
  shots: number | null;
  hits: number | null;
  overshots: number | null;
  dmg_done: number | null;
  dmg_possible: number | null;
}

export interface Scenario {
  name: string;
  shape: Shape;
  penalising: 0 | 1;
  budget: number | null;
  pool: number | null;
  bots: number | null;
  clock_s: number | null;
  windowed: 0 | 1;
  evidence: 'perf-countdown' | 'csv-constant-budget' | 'default';
}

/** What `best_before` / `played_before` are, in both filter variants.
 *
 * Materialised rather than computed per row: the browser design measured the
 * correlated-subquery equivalent at 296 ms against 4.2 ms over 12k runs.
 */
export interface MarkSet {
  best_before: number | null;
  played_before: number;
}
export interface RunMarks {
  /** Peers restricted to the same cm/360. */
  cfg: MarkSet;
  /** Peers at any sensitivity. */
  any: MarkSet;
}

export interface RailRow {
  id: string;
  scenario: string;
  started_at: string;
  score: number | null;
  accuracy: number | null;
  spm: number | null;
  cfg_key: string | null;
  /** null when the run has no per-second data. Roughly one run in seven. */
  buckets: number | null;
  shape: Shape | null;
  best_before: number | null;
  played_before: number;
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx astro check`
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
git add web/src/core/types.ts
git commit -m "Define the core types

Mirrors the Python's tables with two differences that matter: the id is a
basename, because a row counter does not survive a re-pick, and perf_file
becomes has_perf, because the browser has no absolute paths and the column was
only ever read as a boolean."
```

---

### Task 5: The stats CSV parser

**Files:**
- Create: `web/src/core/statscsv.ts`
- Test: `web/test/statscsv.test.ts`

**Interfaces:**
- Consumes: `types.ts`.
- Produces:
  - `parseFilename(basename: string): { scenario: string; started_at: string } | null`
  - `cm360(dpi: number | null, sensIncrement: number | null): number | null`
  - `parseKills(text: string): Kill[]`
  - `parseStats(id: string, text: string): Run` — `has_perf` false, `duration_s`/`spm` null; the indexer fills those when a curve attaches.

Port of `aimcurve/statscsv.py`. Three traps carry over and each has a test below:

1. **The file's own `Kill #` column is not the row index.** `Happy Easter!` writes `0` on every row. File order is the index (`statscsv.py:24-29`).
2. **Kill timestamps are wall-clock with no date** and are rebased onto `Challenge Start`; a run crossing midnight goes negative and is wrapped by adding 86400 (`statscsv.py:138-139`).
3. **`damage_possible` is not a summary key.** It only appears in the per-weapon block, so it stays null here and is filled from the curve (`statscsv.py:185-187`).

- [ ] **Step 1: Write the failing test**

Create `web/test/statscsv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cm360, parseFilename, parseKills, parseStats } from '../src/core/statscsv';
import { readStats, statsIds } from './fixtures';

const AIR = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const FINALS = '1w2ts Pasu Perfected Easy - Challenge - 2025.12.29-22.57.12';
const EASTER = 'Happy Easter! - Challenge - 2026.04.06-18.13.05';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';

describe('parseFilename', () => {
  it('splits the scenario from the timestamp', () => {
    expect(parseFilename(`${AIR} Stats.csv`)).toEqual({
      scenario: 'Air Pure Medium',
      started_at: '2026-09-12T16:04:49',
    });
  });

  it('keeps punctuation in a scenario name', () => {
    expect(parseFilename(`${EASTER} Stats.csv`)!.scenario).toBe('Happy Easter!');
  });

  it('rejects a name that is not a run', () => {
    expect(parseFilename('notes.txt')).toBeNull();
  });
});

describe('cm360', () => {
  it('is independent of the active sens scale', () => {
    // The FINALS 33 @ 400 DPI and cm/360 30 @ 1600 DPI are different labels;
    // the formula converts both without knowing which scale was active.
    expect(cm360(400, 0.471429)).toBeCloseTo(69.2725, 4);
    expect(cm360(1600, 0.272143)).toBeCloseTo(30.0, 4);
  });

  it('returns null rather than throwing on unusable input', () => {
    expect(cm360(null, 0.27)).toBeNull();
    expect(cm360(1600, 0)).toBeNull();
  });
});

describe('parseStats', () => {
  it('reads the summary block', () => {
    const run = parseStats(AIR, readStats(AIR));
    expect(run.score).toBeCloseTo(913.998901, 6);
    expect(run.kills).toBe(5);
    expect(run.hits).toBe(5000);
    expect(run.misses).toBe(3501);
    expect(run.shots).toBe(8501);
    expect(run.accuracy).toBeCloseTo(0.5881660981061052, 12);
    expect(run.avg_ttk).toBeCloseTo(17.197433, 6);
    expect(run.fight_time).toBeCloseTo(84.948997, 6);
    expect(run.game_version).toBe('3.9.9.2026-09-08-13-49-08-01c79144c86c');
  });

  it('reads the settings block and derives the sensitivity key', () => {
    const run = parseStats(AIR, readStats(AIR));
    expect(run.dpi).toBe(1600);
    expect(run.sens_increment).toBeCloseTo(0.272143, 6);
    expect(run.sens_scale).toBe('cm/360');
    expect(run.cm360).toBe(30.0);
    expect(run.cfg_key).toBe('30.0');
    expect(run.fov).toBe(103.0);
    expect(run.resolution).toBe('3440x1440');
  });

  it('keys a non-cm/360 scale on true centimetres', () => {
    const run = parseStats(FINALS, readStats(FINALS));
    expect(run.sens_scale).toBe('The FINALS');
    expect(run.cm360).toBe(69.27);
    expect(run.cfg_key).toBe('69.3');
  });

  it('leaves damage_possible null — it is not a summary key', () => {
    expect(parseStats(AIR, readStats(AIR)).damage_possible).toBeNull();
  });

  it('takes elapsed from the last kill', () => {
    expect(parseStats(AIR, readStats(AIR)).elapsed_s).toBeCloseTo(85.994, 3);
  });

  it('leaves elapsed null when nothing ever dies', () => {
    const run = parseStats(TRACKING, readStats(TRACKING));
    expect(run.elapsed_s).toBeNull();
    expect(run.kills).toBe(0);
  });

  it('reads the counters that only some scenarios use', () => {
    expect(parseStats(AIR, readStats(AIR)).overshots).toBe(100);
    const reload = 'Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01';
    expect(parseStats(reload, readStats(reload)).reloads).toBe(1);
  });

  it('parses every fixture without throwing', () => {
    for (const id of statsIds()) {
      const run = parseStats(id, readStats(id));
      expect(run.scenario).toBeTruthy();
      expect(run.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

describe('parseKills', () => {
  it('indexes by file order, not by the Kill # column', () => {
    // Happy Easter! writes 0 in Kill # on every row. Indexing on it would
    // collide, and file order is what every consumer actually wants.
    const kills = parseKills(readStats(EASTER));
    expect(kills).toHaveLength(2);
    expect(kills.map((k) => k.idx)).toEqual([1, 2]);
  });

  it('rebases timestamps onto Challenge Start', () => {
    const kills = parseKills(readStats(AIR));
    expect(kills).toHaveLength(5);
    expect(kills[0].t).toBeCloseTo(14.395, 3);
    expect(kills[4].t).toBeCloseTo(85.994, 3);
  });

  it('reads the per-kill columns', () => {
    const kills = parseKills(readStats(AIR));
    expect(kills[0].bot).toBe('AIR1_Short_close');
    expect(kills[0].ttk).toBeCloseTo(14.137001, 6);
    expect(kills[4].bot).toBe('AIR2_Mid_UFO');
    expect(kills[4].ttk).toBeCloseTo(20.050001, 6);
  });

  it('returns nothing for a run whose bots never die', () => {
    expect(parseKills(readStats(TRACKING))).toEqual([]);
  });

  it('sums TTK to fight time', () => {
    // Fight Time == sum(TTK) exactly, and excludes the inter-bot gaps. If this
    // drifts, the race split table stops reconciling.
    const kills = parseKills(readStats(AIR));
    const total = kills.reduce((a, k) => a + (k.ttk ?? 0), 0);
    expect(total).toBeCloseTo(84.948997, 4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/statscsv.test.ts`
Expected: `Failed to resolve import "../src/core/statscsv"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/core/statscsv.ts`:

```ts
/** Reading `stats/*.csv`.
 *
 * The file is three blocks, not a CSV table: a per-kill matrix, a `Key:,Value`
 * summary, and a `Key:,Value` settings snapshot. Only lines whose key ends in
 * ':' are pairs; everything else in the leading block is a kill row.
 *
 * A port of `aimcurve/statscsv.py`. Where the two could differ, the Python is
 * right.
 */

import type { Kill, Run } from './types';

// cm/360 = C / (DPI * Sens Increment). Empirically derived: across 2083 runs
// whose Sens Scale is literally cm/360, DPI * increment * label is constant to
// 7 significant figures.
export const CM360_CONSTANT = 13062.86;

const FILENAME =
  /^(.+) - Challenge - (\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}) Stats\.csv$/;

// Kill rows are positional, not keyed, so the column order is the contract.
const KILL_COLUMNS = 13;
const CLOCK = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/;

const FLOATS: Record<string, keyof Run> = {
  Score: 'score',
  'Damage Done': 'damage_done',
  'Avg TTK': 'avg_ttk',
  'Fight Time': 'fight_time',
  'Horiz Sens': 'sens_raw',
  'Sens Increment': 'sens_increment',
  FOV: 'fov',
  'Avg FPS': 'avg_fps',
  'Damage Taken': 'damage_taken',
};
const INTS: Record<string, keyof Run> = {
  Kills: 'kills',
  'Hit Count': 'hits',
  'Miss Count': 'misses',
  'Pause Count': 'pause_count',
  DPI: 'dpi',
  'Total Overshots': 'overshots',
  Reloads: 'reloads',
};
const STRINGS: Record<string, keyof Run> = {
  Scenario: 'scenario',
  Hash: 'hash',
  'Game Version': 'game_version',
  'Sens Scale': 'sens_scale',
  FOVScale: 'fov_scale',
  Resolution: 'resolution',
};

function toNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function toInt(text: string | undefined): number | null {
  const value = toNumber(text);
  // Python's int(float(text)) truncates toward zero, and so does this.
  return value === null ? null : Math.trunc(value);
}

function clockSeconds(text: string): number | null {
  const match = CLOCK.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** A `Fight Time`-style value: seconds with an optional trailing 's'. */
function seconds(text: string | undefined): number | null {
  return toNumber(text?.trim().replace(/s$/, ''));
}

export function cm360(dpi: number | null, sensIncrement: number | null): number | null {
  if (dpi === null || sensIncrement === null) return null;
  const denominator = dpi * sensIncrement;
  if (!denominator) return null;
  return CM360_CONSTANT / denominator;
}

export function parseFilename(
  basename: string,
): { scenario: string; started_at: string } | null {
  const m = FILENAME.exec(basename);
  if (!m) return null;
  return {
    scenario: m[1],
    started_at: `${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}`,
  };
}

/** The per-kill block, with `t` as seconds from Challenge Start.
 *
 * Returns [] for the ~46% of runs whose bots are invincible and never die.
 */
export function parseKills(text: string): Kill[] {
  const rows: string[][] = [];
  let start: number | null = null;

  for (const line of text.split('\n')) {
    const comma = line.indexOf(',');
    if (comma >= 0) {
      const key = line.slice(0, comma);
      if (key === 'Challenge Start:') {
        start = clockSeconds(line.slice(comma + 1));
        continue;
      }
      if (key.endsWith(':')) continue;
    }
    const fields = line.replace(/\r?$/, '').split(',');
    // fields[0] must be all digits: that is what separates a kill row from the
    // block header and from a blank line.
    if (fields.length < KILL_COLUMNS || !/^\d+$/.test(fields[0])) continue;
    rows.push(fields);
  }

  if (start === null) return [];

  const kills: Kill[] = [];
  rows.forEach((fields, i) => {
    const at = clockSeconds(fields[1]);
    if (at === null) return;
    let offset = at - start!;
    if (offset < 0) offset += 86400; // the run crossed midnight
    kills.push({
      idx: i + 1,
      t: offset,
      bot: fields[2],
      weapon: fields[3],
      ttk: seconds(fields[4]),
      shots: toInt(fields[5]),
      hits: toInt(fields[6]),
      dmg_done: toNumber(fields[8]),
      dmg_possible: toNumber(fields[9]),
      overshots: toInt(fields[12]),
    });
  });
  return kills;
}

export function parseStats(id: string, text: string): Run {
  const named = parseFilename(`${id} Stats.csv`);

  const run: Run = {
    id,
    scenario: named?.scenario ?? '',
    started_at: named?.started_at ?? '',
    has_perf: false,
    score: null, kills: null, hits: null, misses: null, shots: null,
    accuracy: null, damage_done: null, damage_possible: null,
    avg_ttk: null, fight_time: null, pause_count: null,
    duration_s: null, spm: null, elapsed_s: null,
    overshots: null, reloads: null, damage_taken: null,
    hash: null, game_version: null,
    sens_raw: null, sens_scale: null, dpi: null, sens_increment: null,
    cm360: null, cfg_key: null,
    fov: null, fov_scale: null, resolution: null, avg_fps: null,
  };

  const set = <K extends keyof Run>(key: K, value: Run[K]) => { run[key] = value; };

  for (const line of text.split('\n')) {
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const rawKey = line.slice(0, comma);
    if (!rawKey.endsWith(':')) continue; // kill row, blank line, or a header
    const key = rawKey.slice(0, -1);
    const value = line.slice(comma + 1).trim();
    if (key in FLOATS) set(FLOATS[key] as 'score', toNumber(value));
    else if (key in INTS) set(INTS[key] as 'kills', toInt(value));
    else if (key in STRINGS) set(STRINGS[key] as 'hash', value);
  }

  const { hits, misses } = run;
  run.shots = hits !== null && misses !== null ? hits + misses : null;
  run.accuracy = run.shots ? (hits as number) / run.shots : null;

  // Elapsed is the CSV's own answer, not the .perf's: it is exact, it works on
  // the ~1-in-7 runs with no .perf, and for a race scenario it IS the score.
  const kills = parseKills(text);
  run.elapsed_s = kills.length ? kills[kills.length - 1].t : null;

  // damage_possible is not a summary key; it is only in the per-weapon block.
  // The curve carries it, so leave it null rather than guessing.
  run.damage_possible = null;

  const exact = cm360(run.dpi, run.sens_increment);
  run.cm360 = exact === null ? null : Number(exact.toFixed(2));
  // Python formats with round-half-to-even and this rounds half away from
  // zero. A value landing exactly on a tie would disagree; none does in this
  // corpus, and the full-corpus diff is what settles whether any ever does.
  run.cfg_key = exact === null ? null : exact.toFixed(1);
  return run;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run test/statscsv.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/statscsv.ts web/test/statscsv.test.ts
git commit -m "Port the stats CSV parser

Three traps carry over from the Python and each has a test: the Kill # column
is not the row index, kill timestamps are wall-clock and must be rebased onto
Challenge Start, and damage_possible is not a summary key."
```

---

### Task 6: The `.perf` decoder

**Files:**
- Create: `web/src/core/perf.ts`
- Test: `web/test/perf.test.ts`

**Interfaces:**
- Consumes: `types.ts`.
- Produces: `parsePerf(bytes: Uint8Array): Curve & { header: PerfHeader }`, and `class PerfError extends Error`.

Port of `aimcurve/perf.py`. **The two traps this port is most likely to fail, both asserted below:**

1. **A metric is omitted for any second in which it was zero**, so sample order is not time order. `Pasu Voltaic Reload Easier` has 59 shot buckets, 43 hit buckets and 26 miss buckets in a 60-bucket run. Every series is rebuilt on a dense `floor(timestamp)` grid, gaps left at zero.
2. **Within a sample, integer series are protobuf varints and float series are fixed32.** A decoder that reads only fixed32 parses cleanly and silently returns zeros for `shots`, `hits`, `misses` and `kills` — four of the seven series.

Accumulation must be into a `Float32Array`, not a `number[]` that is converted later: Python's `array('f')` rounds to binary32 after every `+=`, and matching that is what makes curve values comparable with no tolerance.

- [ ] **Step 1: Write the failing test**

Create `web/test/perf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PerfError, parsePerf } from '../src/core/perf';
import { readPerf, readTruncatedPerf } from './fixtures';

const AIR = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const RELOAD = 'Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';
const GROUND = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';

const sum = (a: Float32Array) => Array.from(a).reduce((x, y) => x + y, 0);
const nonZero = (a: Float32Array) => Array.from(a).filter((v) => v !== 0).length;

describe('parsePerf', () => {
  it('rebuilds a dense one-second grid', () => {
    const c = parsePerf(readPerf(AIR)!);
    expect(c.buckets).toBe(86);
    expect(c.duration_s).toBeCloseTo(85.98716735839844, 10);
    for (const name of Object.keys(c.series) as (keyof typeof c.series)[]) {
      expect(c.series[name]).toHaveLength(86);
      expect(c.series[name]).toBeInstanceOf(Float32Array);
    }
  });

  it('sums each series to the CSV total', () => {
    // This is the validation that recovered the field map in the first place.
    const c = parsePerf(readPerf(AIR)!);
    expect(sum(c.series.shots)).toBe(8501);
    expect(sum(c.series.hits)).toBe(5000);
    expect(sum(c.series.misses)).toBe(3501);
    expect(sum(c.series.dmg_done)).toBe(5000);
    expect(sum(c.series.dmg_possible)).toBe(8501);
    expect(sum(c.series.kills)).toBe(5);
    expect(sum(c.series.score)).toBeCloseTo(913.9939, 3);
  });

  it('reads varint series, not only fixed32 ones', () => {
    // shots/hits/misses/kills are varints and dmg/score are fixed32. A decoder
    // that reads only fixed32 parses without error and returns four zero
    // series, which is why this is asserted rather than assumed.
    const c = parsePerf(readPerf(TRACKING)!);
    expect(sum(c.series.shots)).toBe(6001);
    expect(sum(c.series.hits)).toBe(3913);
    expect(sum(c.series.misses)).toBe(2088);
    expect(sum(c.series.dmg_done)).toBe(3913);
  });

  it('leaves omitted zero buckets at zero rather than compacting them', () => {
    // 60 seconds of play, but only 26 of them recorded a miss. If sample order
    // were treated as time order every curve would silently shift left.
    const c = parsePerf(readPerf(RELOAD)!);
    expect(c.buckets).toBe(60);
    expect(nonZero(c.series.shots)).toBe(59);
    expect(nonZero(c.series.hits)).toBe(43);
    expect(nonZero(c.series.misses)).toBe(26);
    expect(Array.from(c.series.misses.slice(0, 6))).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('places events in the second they happened', () => {
    // Five kills in an 86-second run, at the seconds the CSV also reports.
    const c = parsePerf(readPerf(AIR)!);
    const at = Array.from(c.series.kills)
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0);
    expect(at).toEqual([14, 31, 47, 65, 85]);
  });

  it('reads the header', () => {
    const c = parsePerf(readPerf(AIR)!);
    expect(c.header.scenario).toBe('Air Pure Medium');
    expect(c.header.hash).toBe('d852bc1c12b4bfd7cac1752067620ce2');
  });

  it('carries a race scenario countdown in the score series', () => {
    const c = parsePerf(readPerf(AIR)!);
    expect(c.series.score[0]).toBeCloseTo(998.9974, 3);
    expect(c.series.score[1]).toBeCloseTo(-0.999, 3);
    expect(c.series.score[2]).toBeCloseTo(-0.9996, 3);
  });

  it('books damage only at kill time on some scenarios', () => {
    // 5928 shots but 5.93 damage possible. This is the signature the payload
    // builder uses to withhold the efficiency metric.
    const c = parsePerf(readPerf(GROUND)!);
    expect(sum(c.series.shots)).toBe(5928);
    expect(sum(c.series.dmg_possible)).toBeCloseTo(5.9278, 3);
  });

  it('rejects a truncated file rather than returning a short curve', () => {
    expect(() => parsePerf(readTruncatedPerf())).toThrow(PerfError);
    expect(() => parsePerf(readTruncatedPerf()))
      .toThrow('truncated length-delimited field');
  });

  it('rejects an empty file', () => {
    expect(() => parsePerf(new Uint8Array(0))).toThrow(PerfError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/perf.test.ts`
Expected: `Failed to resolve import "../src/core/perf"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/core/perf.ts`:

```ts
/** Decoding `performances/*.perf`.
 *
 * KovaaK's publishes no schema. The layout below was recovered from the
 * protobuf wire format and validated by summation against the CSV totals.
 *
 *     top level
 *       field 1  header submessage
 *                  1 scenario name, 2 hash, 3 epoch-ms start,
 *                  4 unknown int, 5 submessage (bot file, map, weapon)
 *       field 2  repeated sample: field 1 = float timestamp, plus exactly one
 *                metric submessage whose field number selects the series
 *
 * THE TRAP: a metric is omitted for a second in which it was zero, so sample
 * order is not time order and the series have different lengths in the file.
 * Every series is rebuilt here on a dense floor(timestamp) grid.
 *
 * THE OTHER TRAP: integer series arrive as varints and float series as
 * fixed32. Reading only the fixed32s parses cleanly and yields four zero
 * series.
 */

import { SERIES, type Curve, type PerfHeader, type Series, type SeriesName } from './types';

export class PerfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerfError';
  }
}

const FIELD_TO_SERIES: Record<number, SeriesName> = {
  2: 'shots',
  3: 'hits',
  4: 'misses',
  5: 'dmg_done',
  6: 'dmg_possible',
  7: 'score',
  8: 'kills',
};

const TEXT = new TextDecoder('utf-8');

interface Field {
  number: number;
  wire: number;
  /** varint value for wire 0; a subarray for wires 1, 2 and 5. */
  value: number | Uint8Array;
}

function readVarint(buf: Uint8Array, i: number): [number, number] {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (i >= buf.length) throw new PerfError('truncated varint');
    const byte = buf[i];
    i += 1;
    // Multiplication rather than `<< shift`: JS bitwise operators are 32-bit,
    // and the header's epoch-ms start does not fit in 32.
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [result, i];
    shift += 7;
    if (shift > 63) throw new PerfError('varint too long');
  }
}

/** Every (field number, wire type, payload) at one nesting level. */
function* fields(buf: Uint8Array): Generator<Field> {
  let i = 0;
  while (i < buf.length) {
    let key: number;
    [key, i] = readVarint(buf, i);
    const number = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      let value: number;
      [value, i] = readVarint(buf, i);
      yield { number, wire, value };
    } else if (wire === 5) {
      if (i + 4 > buf.length) throw new PerfError('truncated fixed32');
      yield { number, wire, value: buf.subarray(i, i + 4) };
      i += 4;
    } else if (wire === 1) {
      if (i + 8 > buf.length) throw new PerfError('truncated fixed64');
      yield { number, wire, value: buf.subarray(i, i + 8) };
      i += 8;
    } else if (wire === 2) {
      let length: number;
      [length, i] = readVarint(buf, i);
      if (i + length > buf.length) {
        throw new PerfError('truncated length-delimited field');
      }
      yield { number, wire, value: buf.subarray(i, i + length) };
      i += length;
    } else {
      throw new PerfError(`unsupported wire type ${wire}`);
    }
  }
}

function f32(raw: Uint8Array): number {
  return new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true);
}

function parseHeader(payload: Uint8Array): PerfHeader {
  const out: PerfHeader = { scenario: null, hash: null, started_ms: null };
  for (const { number, wire, value } of fields(payload)) {
    if (number === 1 && wire === 2) out.scenario = TEXT.decode(value as Uint8Array);
    else if (number === 2 && wire === 2) out.hash = TEXT.decode(value as Uint8Array);
    else if (number === 3 && wire === 0) out.started_ms = value as number;
  }
  return out;
}

type Sample = [timestamp: number, name: SeriesName, value: number];

function parseSample(payload: Uint8Array): Sample | null {
  let timestamp: number | null = null;
  let found: [SeriesName, number] | null = null;
  for (const { number, wire, value } of fields(payload)) {
    if (number === 1 && wire === 5) {
      timestamp = f32(value as Uint8Array);
    } else if (wire === 2 && number in FIELD_TO_SERIES) {
      for (const inner of fields(value as Uint8Array)) {
        if (inner.number !== 1) continue;
        found = [
          FIELD_TO_SERIES[number],
          inner.wire === 5 ? f32(inner.value as Uint8Array) : (inner.value as number),
        ];
      }
    }
  }
  if (timestamp === null || found === null) return null;
  return [timestamp, found[0], found[1]];
}

export function parsePerf(raw: Uint8Array): Curve & { header: PerfHeader } {
  if (!raw.length) throw new PerfError('empty file');

  let header: PerfHeader = { scenario: null, hash: null, started_ms: null };
  const samples: Sample[] = [];
  let lastTimestamp = 0;

  for (const { number, wire, value } of fields(raw)) {
    if (number === 1 && wire === 2) {
      header = parseHeader(value as Uint8Array);
    } else if (number === 2 && wire === 2) {
      const parsed = parseSample(value as Uint8Array);
      if (parsed === null) continue;
      samples.push(parsed);
      if (parsed[0] > lastTimestamp) lastTimestamp = parsed[0];
    }
  }

  if (!samples.length) throw new PerfError('no samples decoded');

  // Dense grid. floor(timestamp) is the bucket; gaps stay zero.
  const buckets = Math.trunc(lastTimestamp) + 1;
  const series = Object.fromEntries(
    SERIES.map((name) => [name, new Float32Array(buckets)]),
  ) as Series;

  for (const [timestamp, name, value] of samples) {
    const index = Math.trunc(timestamp);
    // Accumulating into the Float32Array rather than a number[] is deliberate:
    // Python's array('f') rounds to binary32 after every +=, and curve values
    // are compared against it with no tolerance.
    if (index >= 0 && index < buckets) series[name][index] += value;
  }

  return { buckets, duration_s: lastTimestamp, series, header };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run test/perf.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/perf.ts web/test/perf.test.ts
git commit -m "Port the .perf decoder

Both traps are asserted rather than assumed: zero seconds are omitted from the
file so sample order is not time order, and integer series are varints while
float ones are fixed32 -- a decoder reading only fixed32 parses cleanly and
silently returns four empty series."
```

---

### Task 7: Scenario shape classification

**Files:**
- Create: `web/src/core/shapes.ts`
- Test: `web/test/shapes.test.ts`

**Interfaces:**
- Consumes: `types.ts`.
- Produces:
  - `countdownBudget(score: ArrayLike<number>): number | null`
  - `budgetFromTotals(pairs: [number | null, number | null][]): number | null`
  - `fixedWindows(ttkBySlot: Map<number, (number | null)[]>): number | null`
  - `isPenalising(score: ArrayLike<number>): boolean`
  - `classify(curves, totals): { shape: Shape; budget: number | null; evidence: Scenario['evidence'] }`
  - Constants `RACE`, `TIMED`.

Port of `aimcurve/shapes.py`. Every threshold there is measured, not chosen; keep the values and the comments that justify them.

- [ ] **Step 1: Write the failing test**

Create `web/test/shapes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePerf } from '../src/core/perf';
import {
  budgetFromTotals, classify, countdownBudget, fixedWindows, isPenalising,
} from '../src/core/shapes';
import { parseKills } from '../src/core/statscsv';
import { readPerf, readStats } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const PENALISING = 'VT 1w2ts Horizontal Small - Challenge - 2026.06.22-18.48.41';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';

const score = (id: string) => parsePerf(readPerf(id)!).series.score;
const ttks = (id: string) => parseKills(readStats(id)).map((k) => k.ttk);

describe('countdownBudget', () => {
  it('recognises a race scenario countdown', () => {
    expect(countdownBudget(score(AIR_B))).toBeCloseTo(999.9973754882812, 10);
    expect(countdownBudget(score(AIR_A))).toBeCloseTo(999.9983520507812, 10);
  });

  it('does not fire on a fixed-clock scenario', () => {
    expect(countdownBudget(score(GROUND_A))).toBeNull();
    expect(countdownBudget(score(TRACKING))).toBeNull();
  });

  it('does not mistake a penalising scenario for a countdown', () => {
    // Negative buckets are not a clock. A countdown is negative in *every*
    // interior bucket by construction; a penalty is occasional.
    expect(countdownBudget(score(PENALISING))).toBeNull();
  });

  it('tolerates jitter but not a wrong shape', () => {
    // >=90%, not 100%: bucketing by floor(timestamp) occasionally merges two
    // ticks into one bucket, producing a 0 beside a -2.
    const jittery = [999, -1, -1, 0, -2, -1, -1, -1, -1, -1, -1, -0.4];
    expect(countdownBudget(jittery)).toBeCloseTo(1000, 6);
    const half = [999, -1, -1, 5, 5, 5, 5, -1, -1, -1, -1, -0.4];
    expect(countdownBudget(half)).toBeNull();
  });

  it('needs a positive seed and enough buckets', () => {
    expect(countdownBudget([999, -1, -1])).toBeNull();
    expect(countdownBudget([-1, -1, -1, -1, -1])).toBeNull();
  });
});

describe('budgetFromTotals', () => {
  it('settles a race scenario with no .perf at all', () => {
    // Air Spectral Easy: two runs, no performance files. Constant budget,
    // 12.5 s of duration spread.
    expect(budgetFromTotals([[914.885254, 85.093], [927.416626, 72.567]]))
      .toBeCloseTo(999.98094, 5);
  });

  it('refuses a single run', () => {
    // One run landing near a round hundred minus its clock is a coincidence;
    // 6 of 2360 fixed-clock runs do it.
    expect(budgetFromTotals([[914.885254, 85.093]])).toBeNull();
  });

  it('refuses when the budget is not constant', () => {
    expect(budgetFromTotals([[900, 85], [950, 72]])).toBeNull();
  });

  it('refuses when the duration barely varies', () => {
    expect(budgetFromTotals([[940.0, 60.0], [940.2, 59.8]])).toBeNull();
  });

  it('ignores pairs it cannot use', () => {
    expect(budgetFromTotals([[914.885254, 85.093], [927.416626, null], [null, 72.567]]))
      .toBeNull();
  });
});

describe('fixedWindows', () => {
  it('recognises slots whose length the scenario fixes', () => {
    // Invincible bots never die; KovaaK's still writes a kill row per bot and
    // the TTK is the window the scenario gave it, identical run to run.
    const bySlot = new Map<number, (number | null)[]>([
      [1, [ttks(GROUND_A)[0], ttks(GROUND_B)[0]]],
      [2, [ttks(GROUND_A)[1], ttks(GROUND_B)[1]]],
      [3, [ttks(GROUND_A)[2], ttks(GROUND_B)[2]]],
    ]);
    expect(fixedWindows(bySlot)).toBe(3);
  });

  it('rejects slots that record how long a kill actually took', () => {
    const bySlot = new Map<number, (number | null)[]>([
      [1, [ttks(AIR_A)[0], ttks(AIR_B)[0]]],
      [2, [ttks(AIR_A)[1], ttks(AIR_B)[1]]],
    ]);
    expect(fixedWindows(bySlot)).toBeNull();
  });

  it('needs two runs before it will call a slot fixed', () => {
    expect(fixedWindows(new Map([[1, [18.996]]]))).toBeNull();
  });

  it('skips slots too thin to judge rather than failing the scenario', () => {
    // A run quit part-way leaves later slots with one sample.
    const bySlot = new Map<number, (number | null)[]>([
      [1, [18.996, 18.993]],
      [2, [20.392, 20.390001]],
      [3, [20.398001]],
    ]);
    expect(fixedWindows(bySlot)).toBe(2);
  });

  it('returns null when nothing is judgeable', () => {
    expect(fixedWindows(new Map())).toBeNull();
    expect(fixedWindows(new Map([[1, [null, null]]]))).toBeNull();
  });
});

describe('isPenalising', () => {
  it('is true when a second cost points outright', () => {
    expect(isPenalising(score(PENALISING))).toBe(true);
  });

  it('is false for a scenario that only ever gains', () => {
    expect(isPenalising(score(TRACKING))).toBe(false);
  });

  it('is true of a countdown too, which is why it is only asked of timed', () => {
    // A countdown is negative every bucket by construction. That is the clock,
    // not a penalty, so refreshScenario never asks this of a race.
    expect(isPenalising(score(AIR_B))).toBe(true);
  });
});

describe('classify', () => {
  it('prefers curve evidence, which settles a scenario from one run', () => {
    expect(classify([Array.from(score(AIR_B))], [[913.998901, 85.994]])).toEqual({
      shape: 'race',
      budget: expect.closeTo(999.9973754882812, 8),
      evidence: 'perf-countdown',
    });
  });

  it('falls back to totals when there is no curve', () => {
    const verdict = classify([], [[914.885254, 85.093], [927.416626, 72.567]]);
    expect(verdict.shape).toBe('race');
    expect(verdict.evidence).toBe('csv-constant-budget');
  });

  it('defaults to timed, which is the safe direction', () => {
    const verdict = classify([Array.from(score(GROUND_A))], [[1814, 59.801]]);
    expect(verdict).toEqual({ shape: 'timed', budget: null, evidence: 'default' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/shapes.test.ts`
Expected: `Failed to resolve import "../src/core/shapes"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/core/shapes.ts`:

```ts
/** Scenario scoring shapes.
 *
 * Most scenarios are scored on a fixed clock. Ten in the reference install are
 * not: they spawn a fixed number of bots and score on elapsed time, writing the
 * score series as a literal countdown. Telling the two apart is what lets the
 * dashboard pick an axis that means something.
 *
 * Everything here is pure over already-parsed values.
 */

import type { Scenario, Shape } from './types';

export const RACE = 'race' as const;
export const TIMED = 'timed' as const;

// >=90%, not 100%: the .perf buckets samples by floor(timestamp), so timing
// jitter occasionally merges two ticks into one bucket (a 0 beside a -2). A
// strict rule scores 123/126 on real runs; this one scores 126/126 with no
// false positives.
const COUNTDOWN_MIN_FRACTION = 0.9;
// The series round-trips through float32, which moves -1 by up to ~0.0025.
const COUNTDOWN_TOLERANCE = 0.01;

const BUDGET_TOLERANCE = 0.1;
const MIN_DURATION_SPREAD = 1.0;

// A bot whose window the scenario fixes writes the same TTK every run; a bot
// you actually kill writes how long it took you. Measured over the reference
// install, the widest relative spread among fixed-window slots is 0.0001 and
// the tightest among real kills is 0.081. This sits in the empty 800x between
// them, so it is a threshold in name only.
const WINDOW_MAX_SPREAD = 0.02;
// One run cannot show a TTK is fixed rather than merely what happened once.
const WINDOW_MIN_RUNS = 2;

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pstdev(values: number[]): number {
  const mu = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - mu) ** 2)));
}

/** The budget if `score` is a countdown clock, else null.
 *
 * A race scenario's score arrives as [budget-1, -1, -1, ...]: the first bucket
 * seeds the clock and every later one is a second ticking off. The final bucket
 * is a partial second, so it is excluded rather than tested.
 */
export function countdownBudget(score: ArrayLike<number>): number | null {
  const values = Array.from(score);
  if (values.length < 4 || values[0] <= 0) return null;
  const body = values.slice(1, -1);
  if (!body.length) return null;
  const ticks = body.filter((v) => Math.abs(v + 1) < COUNTDOWN_TOLERANCE).length;
  if (ticks / body.length < COUNTDOWN_MIN_FRACTION) return null;
  return values[0] + 1;
}

/** The budget if (score, elapsed) pairs show a constant budget over varying
 *  time, else null.
 *
 * The fallback for race scenarios with no .perf. Two runs minimum, and that
 * minimum is the whole point: 6 of 2360 fixed-clock runs have a score that
 * lands near a round hundred minus their clock, so one run is a coincidence.
 */
export function budgetFromTotals(
  pairs: readonly (readonly [number | null, number | null])[],
): number | null {
  const usable = pairs.filter(
    (p): p is [number, number] => p[0] !== null && !!p[1],
  );
  if (usable.length < 2) return null;
  const budgets = usable.map(([s, e]) => s + e);
  const elapsed = usable.map(([, e]) => e);
  if (Math.max(...budgets) - Math.min(...budgets) > BUDGET_TOLERANCE) return null;
  if (Math.max(...elapsed) - Math.min(...elapsed) < MIN_DURATION_SPREAD) return null;
  return mean(budgets);
}

/** The bot count if every slot's length is fixed by the scenario, else null.
 *
 * `ttkBySlot` maps a kill's index to that slot's TTK across every run of the
 * scenario. Slots too thin to judge are skipped rather than failing the
 * scenario, since a run quit part-way leaves later slots with one sample.
 */
export function fixedWindows(
  ttkBySlot: ReadonlyMap<number, readonly (number | null)[]>,
): number | null {
  const slots = new Map<number, number[]>();
  for (const [idx, values] of ttkBySlot) {
    const usable = values.filter((t): t is number => !!t);
    if (usable.length >= WINDOW_MIN_RUNS) slots.set(idx, usable);
  }
  if (!slots.size) return null;
  for (const values of slots.values()) {
    const mu = mean(values);
    if (mu <= 0) return null;
    if (pstdev(values) / mu > WINDOW_MAX_SPREAD) return null;
  }
  return Math.max(...slots.keys());
}

/** Whether any second of the run cost points outright. */
export function isPenalising(score: ArrayLike<number>): boolean {
  return Array.from(score).some((v) => v < 0);
}

export interface Verdict {
  shape: Shape;
  budget: number | null;
  evidence: Scenario['evidence'];
}

/** `curves` is every score series available for the scenario, `totals` every
 *  (score, elapsed) pair. Curve evidence wins outright: it settles a scenario
 *  from a single run, where the totals test needs two. */
export function classify(
  curves: readonly ArrayLike<number>[],
  totals: readonly (readonly [number | null, number | null])[],
): Verdict {
  for (const series of curves) {
    const budget = countdownBudget(series);
    if (budget !== null) {
      return { shape: RACE, budget, evidence: 'perf-countdown' };
    }
  }
  const budget = budgetFromTotals(totals);
  if (budget !== null) {
    return { shape: RACE, budget, evidence: 'csv-constant-budget' };
  }
  return { shape: TIMED, budget: null, evidence: 'default' };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run test/shapes.test.ts`
Expected: all passed.

- [ ] **Step 5: Run everything and type-check**

Run: `cd web && npm test && npx astro check`
Expected: all suites passed, `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/shapes.ts web/test/shapes.test.ts
git commit -m "Port scenario shape classification

Every threshold here is measured rather than chosen -- the 90% countdown
fraction, the two-run minimum on the totals fallback, the 0.02 window spread --
so the constants and the comments justifying them port together."
```

**REVIEW CHECKPOINT — stop here.** The three parsers are done and agree with the Python on every fixture. Everything after this consumes their output; a defect here would be invisible later.

---

### Task 8: Curve arithmetic

**Files:**
- Create: `web/src/core/compare.ts`
- Test: `web/test/compare.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `smooth(values: readonly number[], window: number): number[]`
  - `pad(a, b): [number[], number[]]`
  - `cumulativeDelta(mine, base): number[]`
  - `compareUntil(mine, base): number`
  - `band(curves: readonly (readonly number[])[]): { mean: number[]; lo: number[]; hi: number[] }`
  - `raceGrid(bots: number | null): number`
  - `resampleRace(hits: ArrayLike<number>, elapsedS: number, steps: number): [edges: number[], rate: number[]]`
  - `raceDelta(mineEdges, baseEdges): number[]`
  - `RACE_STEPS_PER_BOT`, `DURATION_TOLERANCE`, `DEFAULT_RECENT_N`

Port of the pure half of `aimcurve/compare.py` (lines 1–151). The Store-dependent half — `candidates` and `baselines` — is Task 12.

**`cumulativeDelta` pads rather than truncates, and that is load-bearing.** The final value must equal `sum(mine) - sum(base)` exactly, because the score series sums to the run's score — so the last point of the curve *is* the score difference and the chart can never disagree with the headline. Truncating breaks it on ~6% of real runs.

- [ ] **Step 1: Write the failing test**

Create `web/test/compare.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  band, compareUntil, cumulativeDelta, pad, raceDelta, raceGrid, resampleRace, smooth,
} from '../src/core/compare';
import { parsePerf } from '../src/core/perf';
import { readPerf } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';

const curve = (id: string) => parsePerf(readPerf(id)!);
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

describe('smooth', () => {
  it('is a centred rolling mean that shrinks at the edges', () => {
    expect(smooth([1, 2, 3, 4, 5], 3)).toEqual([1.5, 2, 3, 4, 4.5]);
  });

  it('is the identity below a window of two', () => {
    expect(smooth([1, 2, 3], 1)).toEqual([1, 2, 3]);
    expect(smooth([1, 2, 3], 0)).toEqual([1, 2, 3]);
  });

  it('preserves length', () => {
    expect(smooth([1, 2, 3, 4, 5, 6, 7], 5)).toHaveLength(7);
  });

  it('survives an empty series', () => {
    expect(smooth([], 5)).toEqual([]);
  });
});

describe('pad', () => {
  it('zero-extends both to the longer length', () => {
    expect(pad([1, 2, 3], [4])).toEqual([[1, 2, 3], [4, 0, 0]]);
  });
});

describe('cumulativeDelta', () => {
  it('ends exactly at the score difference', () => {
    // THE invariant. Run 11 scored 2009, run 10 scored 1814.
    const mine = Array.from(curve(GROUND_B).series.score);
    const base = Array.from(curve(GROUND_A).series.score);
    const values = cumulativeDelta(mine, base);
    expect(values[values.length - 1]).toBeCloseTo(2009 - 1814, 9);
    expect(values[values.length - 1]).toBeCloseTo(sum(mine) - sum(base), 9);
    expect(values.slice(0, 4)).toEqual([34, 66, 54, 52]);
  });

  it('pads rather than truncates, so totals survive a length mismatch', () => {
    // Truncating to the shorter prefix would report 3 here, not 7.
    expect(cumulativeDelta([5, 5], [2, 0, 3]).at(-1)).toBe(5);
    expect(cumulativeDelta([5, 5, 4], [2, 0]).at(-1)).toBe(12);
  });

  it('holds on curves of different lengths from the corpus', () => {
    const mine = Array.from(curve(AIR_B).series.score);   // 86 buckets
    const base = Array.from(curve(AIR_A).series.score);   // 94 buckets
    const values = cumulativeDelta(mine, base);
    expect(values).toHaveLength(94);
    expect(values.at(-1)).toBeCloseTo(sum(mine) - sum(base), 9);
  });
});

describe('compareUntil', () => {
  it('is the index past which only one curve has data', () => {
    expect(compareUntil([1, 2, 3], [1, 2])).toBe(2);
  });
});

describe('band', () => {
  it('collapses onto the mean under three curves', () => {
    // A standard deviation over two samples is noise pretending to be a
    // confidence band.
    expect(band([[1, 2], [3, 4]])).toEqual({
      mean: [2, 3], lo: [2, 3], hi: [2, 3],
    });
  });

  it('is mean +- one population sigma at three or more', () => {
    const b = band([[1, 2], [3, 4], [5, 9]]);
    expect(b.mean).toEqual([3, 5]);
    expect(b.lo[0]).toBeCloseTo(1.367007, 5);
    expect(b.hi[1]).toBeCloseTo(7.94392, 5);
  });

  it('truncates to the shortest curve', () => {
    expect(band([[1, 2, 3], [3, 4]]).mean).toHaveLength(2);
  });

  it('survives an empty set', () => {
    expect(band([])).toEqual({ mean: [], lo: [], hi: [] });
  });
});

describe('raceGrid', () => {
  it('is forty cells per bot, so kill boundaries land on exact indices', () => {
    expect(raceGrid(5)).toBe(200);
    expect(raceGrid(6)).toBe(240);
    expect(raceGrid(8)).toBe(320);
  });

  it('never returns zero', () => {
    expect(raceGrid(0)).toBe(40);
    expect(raceGrid(null)).toBe(40);
  });
});

describe('resampleRace', () => {
  it('indexes by cumulative damage and anchors to the CSV elapsed', () => {
    const [edges, rate] = resampleRace(curve(AIR_B).series.hits, 85.99399999999878, 200);
    expect(edges).toHaveLength(201);
    expect(rate).toHaveLength(200);
    expect(edges[0]).toBe(0);
    // Anchored, not merely bucketed: the curve's own last edge is rounded to a
    // whole second, and for a race that error lands straight in the score.
    expect(edges.at(-1)).toBeCloseTo(85.99399999999878, 10);
    expect(edges[1]).toBeCloseTo(0.280879, 6);
    expect(rate[0]).toBeCloseTo(89.00621, 5);
    expect(rate[3]).toBeCloseTo(88.563393, 5);
  });

  it('returns nothing usable when there is no damage or no elapsed', () => {
    expect(resampleRace(new Float32Array(10), 85, 200)).toEqual([[], []]);
    expect(resampleRace(curve(AIR_B).series.hits, 0, 200)).toEqual([[], []]);
  });
});

describe('raceDelta', () => {
  it('is seconds gained, ending at the elapsed difference', () => {
    const [mine] = resampleRace(curve(AIR_B).series.hits, 85.99399999999878, 200);
    const [base] = resampleRace(curve(AIR_A).series.hits, 93.84900000000198, 200);
    const values = raceDelta(mine, base);
    expect(values).toHaveLength(200);
    expect(values[0]).toBeCloseTo(0.086177, 6);
    expect(values.at(-1)).toBeCloseTo(7.855, 6);
  });

  it('lands within the CSV timestamp resolution of the score difference', () => {
    // Not exact the way cumulativeDelta is: elapsed comes from a kill
    // timestamp printed to three decimals while score carries the game's own
    // full-precision clock. 0.0057 s apart on this pair.
    const [mine] = resampleRace(curve(AIR_B).series.hits, 85.99399999999878, 200);
    const [base] = resampleRace(curve(AIR_A).series.hits, 93.84900000000198, 200);
    const scoreDiff = 913.998901 - 906.138184;
    expect(raceDelta(mine, base).at(-1)).toBeCloseTo(scoreDiff, 1);
    expect(Math.abs(raceDelta(mine, base).at(-1)! - scoreDiff)).toBeLessThan(0.02);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/compare.test.ts`
Expected: `Failed to resolve import "../src/core/compare"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/core/compare.ts`:

```ts
/** Curve arithmetic.
 *
 * Everything here is pure over arrays. The load-bearing property is in
 * `cumulativeDelta`: its final value is exactly the score difference against
 * the baseline, so the chart and the headline number cannot disagree.
 */

export const DEFAULT_RECENT_N = 10;
export const DURATION_TOLERANCE = 0.1;

/** Centred rolling mean. Preserves length; shrinks the window at the edges. */
export function smooth(values: readonly number[], window: number): number[] {
  if (window <= 1 || !values.length) return Array.from(values);
  const half = Math.floor(window / 2);
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length, i + half + 1);
    let total = 0;
    for (let j = lo; j < hi; j++) total += values[j];
    out.push(total / (hi - lo));
  }
  return out;
}

/** Zero-extend both to the longer length. */
export function pad(
  a: readonly number[], b: readonly number[],
): [number[], number[]] {
  const n = Math.max(a.length, b.length);
  const grow = (xs: readonly number[]) =>
    Array.from(xs).concat(new Array(n - xs.length).fill(0));
  return [grow(a), grow(b)];
}

/** Running sum of (mine - base).
 *
 * Pads rather than truncates, and that choice is load-bearing. The final value
 * must equal sum(mine) - sum(base) exactly, because the score series sums to
 * the run's score -- so the last point of this curve IS the score difference.
 * Truncating breaks that on ~6% of real runs, where the two differ in length.
 */
export function cumulativeDelta(
  mine: readonly number[], base: readonly number[],
): number[] {
  const [m, b] = pad(mine, base);
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < m.length; i++) {
    total += m[i] - b[i];
    out.push(total);
  }
  return out;
}

/** Index past which only one curve has data, for marking the tail. */
export function compareUntil(mine: readonly number[], base: readonly number[]): number {
  return Math.min(mine.length, base.length);
}

export interface Band {
  mean: number[];
  lo: number[];
  hi: number[];
}

/** Per-bucket mean and +-1 sigma across a set of equal-ish curves. */
export function band(curves: readonly (readonly number[])[]): Band {
  const usable = curves.filter((c) => c.length);
  if (!usable.length) return { mean: [], lo: [], hi: [] };
  const n = Math.min(...usable.map((c) => c.length));
  // Under three curves a standard deviation is noise pretending to be a
  // confidence band, so the band collapses onto the mean.
  const banded = usable.length >= 3;
  const mean: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < n; i++) {
    const column = usable.map((c) => c[i]);
    const mu = column.reduce((a, b) => a + b, 0) / column.length;
    const sigma = banded
      ? Math.sqrt(column.reduce((a, v) => a + (v - mu) ** 2, 0) / column.length)
      : 0;
    mean.push(mu);
    lo.push(mu - sigma);
    hi.push(mu + sigma);
  }
  return { mean, lo, hi };
}

// 40 cells per bot: 200-320 points against the ~60-125 native one-second
// buckets, so the grid never invents detail the source cannot support, and
// every kill boundary lands on an exact index rather than between two.
export const RACE_STEPS_PER_BOT = 40;

export function raceGrid(bots: number | null): number {
  return Math.max(1, Math.trunc(bots || 1)) * RACE_STEPS_PER_BOT;
}

/** (edges, rate) on a uniform cumulative-damage grid.
 *
 * `edges[k]` is the time at which the run had done `k/steps` of the damage
 * pool; `rate[k]` is the damage per second within cell k. Indexing by damage
 * rather than by seconds is what makes two runs comparable: kill k always sits
 * at damage `k * pool/bots`, so the boundaries coincide in every run.
 */
export function resampleRace(
  hits: ArrayLike<number>, elapsedS: number, steps: number,
): [number[], number[]] {
  const cumulative: number[] = [];
  let total = 0;
  for (let i = 0; i < hits.length; i++) {
    total += hits[i];
    cumulative.push(total);
  }
  if (!cumulative.length || total <= 0 || !elapsedS) return [[], []];

  const timeAt = (target: number): number => {
    let previous = 0;
    for (let i = 0; i < cumulative.length; i++) {
      const reached = cumulative[i];
      if (reached >= target) {
        const span = reached - previous;
        // bucket i covers [i, i+1); interpolate inside it
        return i + (span > 0 ? (target - previous) / span : 0);
      }
      previous = reached;
    }
    return cumulative.length;
  };

  let edges: number[] = [];
  for (let k = 0; k <= steps; k++) edges.push(timeAt((total * k) / steps));
  // Anchor to the CSV's elapsed. The curve is bucketed to whole seconds, so its
  // own last edge is a rounded approximation -- and for a race that error would
  // land straight in the score difference.
  const span = edges[edges.length - 1];
  if (span > 0) edges = edges.map((e) => (e / span) * elapsedS);

  const cell = total / steps;
  const rate: number[] = [];
  for (let k = 0; k < steps; k++) {
    rate.push(cell / Math.max(edges[k + 1] - edges[k], 1e-6));
  }
  return [edges, rate];
}

/** Seconds gained (+) or lost (-) against the baseline, by progress.
 *
 * The final value is `base_elapsed - mine_elapsed`, which for a race is the
 * score difference to within the CSV's timestamp resolution (+-0.02 s). It is
 * not exact the way cumulativeDelta is: elapsed is derived from a kill
 * timestamp printed to three decimals, while `score` carries the game's own
 * full-precision clock.
 */
export function raceDelta(
  mineEdges: readonly number[], baseEdges: readonly number[],
): number[] {
  const n = Math.min(mineEdges.length, baseEdges.length);
  const out: number[] = [];
  for (let i = 1; i < n; i++) out.push(baseEdges[i] - mineEdges[i]);
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run test/compare.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/compare.ts web/test/compare.test.ts
git commit -m "Port the curve arithmetic

cumulativeDelta pads rather than truncates so its final value stays exactly the
score difference, which is what stops the chart and the headline disagreeing.
resampleRace anchors its last edge to the CSV's elapsed rather than the curve's
own, because on a race that rounding error is the score."
```

---

### Task 9: The scenario fold

**Files:**
- Create: `web/src/core/scenario.ts`
- Test: `web/test/scenario.test.ts`

**Interfaces:**
- Consumes: `shapes.ts`, `types.ts`.
- Produces:

```ts
export interface ScenarioInput {
  run: Run;
  score: Float32Array | null;   // the .perf score series, if any
  kills: Kill[];
}
export function refreshScenario(name: string, inputs: readonly ScenarioInput[]): Scenario | null;
```

Port of `index.refresh_scenario` (`index.py:253-327`), with the SQL replaced by the caller passing rows in. Four rules carry over:

- **Classification runs over every run of the scenario, never one run.** A race scenario is settled by any single good curve, but `fixed_windows` needs two runs and the totals fallback needs two.
- **`pool` and `bots` use `max`, not `median`.** A run quit part-way records fewer kills and fewer hits; the median of two would then halve `bots` and put every kill mark at the wrong fraction. A partial run can only undercount, so `max` cannot be contaminated by one.
- **`penalising` is only asked of timed scenarios.** A countdown is negative in every bucket by construction; that is the clock, not a penalty.
- **`clock_s` is the median duration**, over runs that have one.

- [ ] **Step 1: Write the failing test**

Create `web/test/scenario.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePerf } from '../src/core/perf';
import { refreshScenario, type ScenarioInput } from '../src/core/scenario';
import { parseKills, parseStats } from '../src/core/statscsv';
import { readPerf, readStats } from './fixtures';

function input(id: string): ScenarioInput {
  const run = parseStats(id, readStats(id));
  const bytes = readPerf(id);
  const curve = bytes ? parsePerf(bytes) : null;
  if (curve) {
    run.has_perf = true;
    run.duration_s = curve.duration_s || null;
  }
  return { run, score: curve?.series.score ?? null, kills: parseKills(readStats(id)) };
}

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const SPECTRAL_A = 'Air Spectral Easy - Challenge - 2026.09.05-08.20.43';
const SPECTRAL_B = 'Air Spectral Easy - Challenge - 2026.09.11-18.37.39';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const PENALISING = 'VT 1w2ts Horizontal Small - Challenge - 2026.06.22-18.48.41';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';

describe('refreshScenario', () => {
  it('classifies a race from its countdown and sizes the pool', () => {
    const s = refreshScenario('Air Pure Medium', [input(AIR_A), input(AIR_B)])!;
    expect(s.shape).toBe('race');
    expect(s.evidence).toBe('perf-countdown');
    expect(s.budget).toBeCloseTo(999.9973754882812, 8);
    expect(s.pool).toBe(5000);
    expect(s.bots).toBe(5);
    expect(s.clock_s).toBeNull();
    // Negative every bucket by construction; that is the clock, not a penalty.
    expect(s.penalising).toBe(0);
  });

  it('classifies a race with no .perf from its totals', () => {
    const s = refreshScenario('Air Spectral Easy', [input(SPECTRAL_A), input(SPECTRAL_B)])!;
    expect(s.shape).toBe('race');
    expect(s.evidence).toBe('csv-constant-budget');
    expect(s.budget).toBeCloseTo(999.98094, 4);
    expect(s.pool).toBe(4800);
    expect(s.bots).toBe(6);
  });

  it('holds a curveless race at timed until a second run arrives', () => {
    // The safe direction, and self-correcting.
    const s = refreshScenario('Air Spectral Easy', [input(SPECTRAL_A)])!;
    expect(s.shape).toBe('timed');
  });

  it('detects fixed bot windows on a timed scenario', () => {
    const s = refreshScenario('VT Ground Intermediate S5',
      [input(GROUND_A), input(GROUND_B)])!;
    expect(s.shape).toBe('timed');
    expect(s.windowed).toBe(1);
    expect(s.bots).toBe(3);
    expect(s.clock_s).toBeCloseTo(59.994062423706055, 8);
  });

  it('detects a penalising scenario', () => {
    const s = refreshScenario('VT 1w2ts Horizontal Small', [input(PENALISING)])!;
    expect(s.shape).toBe('timed');
    expect(s.penalising).toBe(1);
    expect(s.windowed).toBe(0);
  });

  it('leaves a plain tracking scenario alone', () => {
    const s = refreshScenario('Air Voltaic Invincible 4 Medium', [input(TRACKING)])!;
    expect(s).toEqual({
      name: 'Air Voltaic Invincible 4 Medium',
      shape: 'timed', penalising: 0, budget: null, pool: null, bots: null,
      clock_s: expect.closeTo(59.985897064208984, 8),
      windowed: 0, evidence: 'default',
    });
  });

  it('sizes a race from the best run, not the average of a partial one', () => {
    // max, not median: a run quit part-way undercounts, and the median of two
    // would halve `bots` and put every kill mark at the wrong fraction.
    const full = input(AIR_B);
    const partial = input(AIR_A);
    partial.run.kills = 2;
    partial.run.hits = 2000;
    const s = refreshScenario('Air Pure Medium', [full, partial])!;
    expect(s.bots).toBe(5);
    expect(s.pool).toBe(5000);
  });

  it('returns null for a scenario with no runs', () => {
    expect(refreshScenario('nothing', [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/scenario.test.ts`
Expected: `Failed to resolve import "../src/core/scenario"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/core/scenario.ts`:

```ts
/** Recomputing one scenario's shape from every run the index holds for it.
 *
 * A fold over rows the caller already has, so it is cheap enough to run on
 * every new run rather than only at bootstrap -- which matters, because a
 * second run is exactly what promotes a curveless race scenario out of 'timed'.
 *
 * Port of `index.refresh_scenario`, with the SQL lifted out: the caller passes
 * the rows in, so this stays free of storage.
 */

import { classify, fixedWindows, isPenalising, RACE } from './shapes';
import type { Kill, Run, Scenario } from './types';

export interface ScenarioInput {
  run: Run;
  /** The `.perf` score series, or null for a run with no curve. */
  score: Float32Array | null;
  kills: Kill[];
}

function median(values: readonly (number | null)[]): number | null {
  const usable = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!usable.length) return null;
  const mid = Math.floor(usable.length / 2);
  return usable.length % 2
    ? usable[mid]
    : (usable[mid - 1] + usable[mid]) / 2;
}

function maximum(values: readonly (number | null)[]): number | null {
  const usable = values.filter((v): v is number => v !== null);
  return usable.length ? Math.max(...usable) : null;
}

export function refreshScenario(
  name: string, inputs: readonly ScenarioInput[],
): Scenario | null {
  if (!inputs.length) return null;

  const curves = inputs
    .map((i) => i.score)
    .filter((s): s is Float32Array => s !== null);

  const verdict = classify(
    curves,
    inputs.map((i) => [i.run.score, i.run.elapsed_s] as const),
  );

  let pool: number | null = null;
  let bots: number | null = null;
  let clock_s: number | null = null;
  let penalising: 0 | 1 = 0;
  let windowed: 0 | 1 = 0;

  if (verdict.shape === RACE) {
    // Hits are the damage pool: every hit is one damage in these scenarios, and
    // the total is identical in every run that ran to the end.
    //
    // max, not median: a run quit part-way records fewer kills and fewer hits,
    // and tier 1 still classifies the scenario race from any one good curve.
    // A partial run can only undercount, so max cannot be contaminated by one.
    pool = maximum(inputs.map((i) => i.run.hits));
    const count = maximum(inputs.map((i) => i.run.kills));
    bots = count === null ? null : Math.trunc(count);
  } else {
    clock_s = median(inputs.map((i) => i.run.duration_s));
    // A countdown is negative every bucket by construction; that is the clock,
    // not a penalty, so this is only asked of timed scenarios.
    penalising = curves.some((c) => isPenalising(c)) ? 1 : 0;
    // Some fixed-clock scenarios spend that clock on a rotation of bots that
    // never die.
    const bySlot = new Map<number, (number | null)[]>();
    for (const { kills } of inputs) {
      for (const kill of kills) {
        const slot = bySlot.get(kill.idx);
        if (slot) slot.push(kill.ttk);
        else bySlot.set(kill.idx, [kill.ttk]);
      }
    }
    const slots = fixedWindows(bySlot);
    if (slots) {
      bots = slots;
      windowed = 1;
    }
  }

  return {
    name,
    shape: verdict.shape,
    penalising,
    budget: verdict.budget,
    pool,
    bots,
    clock_s,
    windowed,
    evidence: verdict.evidence,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run test/scenario.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/scenario.ts web/test/scenario.test.ts
git commit -m "Port the per-scenario fold

Classification is over every run of a scenario, not one: a curve settles a race
outright, but the totals fallback and the fixed-window test both need two runs.
Pool and bot count take the maximum rather than the median so a run quit
part-way cannot halve them."
```

---

### Task 10: The Store interface and materialised marks

**Files:**
- Create: `web/src/core/store.ts`
- Create: `web/src/core/marks.ts`
- Test: `web/test/marks.test.ts`

`store.ts` is types only — it is the boundary that lets the payload builder be tested without IndexedDB and reused with it. `marks.ts` is the one piece of the storage layer that is pure, and it is pure on purpose: the in-memory store and Plan B's IndexedDB indexer both call it, so the node tests exercise the code that ships.

- [ ] **Step 1: Write `web/src/core/store.ts`**

```ts
/** What the payload builder is allowed to know about storage.
 *
 * Two implementations: `memstore.ts` here, and the IndexedDB one in Plan B.
 * The payload builder must never be able to tell which it has -- that is the
 * property that lets it be verified against the Python with no browser
 * involved, and it is the reason Plan B writes no comparison logic at all.
 */

import type { Curve, Kill, RailRow, Run, Scenario, Shape } from './types';

export interface CandidateOpts {
  /** Restrict peers to the focused run's cm/360. */
  sameCfg: boolean;
  durationTol: number;
  /** Duration is the score on a race, so the tolerance filter is skipped. */
  shape: Shape;
}

export interface PageOpts {
  scenario?: string | null;
  /** A run id; the page starts at the run just older than it. */
  before?: string | null;
  sameCfg: boolean;
}

export interface ScenarioListRow {
  scenario: string;
  runs: number;
  pb: number | null;
  last_played: string;
  shape: Shape | null;
  pb_elapsed: number | null;
  recent_elapsed: number | null;
  recent_form: number | null;
}

export interface SessionRow {
  id: string;
  scenario: string;
  started_at: string;
  score: number | null;
  accuracy: number | null;
  spm: number | null;
}

export interface Counts {
  runs: number;
  curves: number;
  failed: number;
  scenarios: number;
}

/** Which "best" a slot lookup wants.
 *
 * A named metric rather than a SQL expression string: there are exactly two
 * callers -- fastest TTK for race splits, largest damage share for bot windows
 * -- and interpolating an expression into a query is a habit worth leaving
 * behind with the SQL.
 */
export type SlotMetric = 'ttk' | 'share';

export interface Store {
  getRun(id: string): Run | undefined;
  getScenario(name: string): Scenario | undefined;
  getCurve(id: string): Curve | undefined;
  getKills(id: string): Kill[];

  /** Other runs of the same scenario this one can fairly be judged against,
   *  oldest first. Excludes the focused run. */
  candidates(id: string, opts: CandidateOpts): Run[];

  /** The rail: newest first, already marked against the whole history. */
  page(limit: number, opts: PageOpts): RailRow[];

  bestBySlot(ids: readonly string[], metric: SlotMetric): Map<number, number>;

  scenarioList(): ScenarioListRow[];
  /** `day` is an ISO date, `YYYY-MM-DD`. */
  day(day: string): SessionRow[];
  /** Every date that has runs, ascending. */
  days(): string[];
  counts(): Counts;
}
```

- [ ] **Step 2: Write the failing test**

Create `web/test/marks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { materialiseMarks } from '../src/core/marks';
import type { Run, Shape } from '../src/core/types';

function run(over: Partial<Run> & Pick<Run, 'id'>): Run {
  return {
    scenario: 'S', started_at: '2026-01-01T00:00:00', has_perf: true,
    score: 100, kills: null, hits: null, misses: null, shots: null,
    accuracy: null, damage_done: null, damage_possible: null,
    avg_ttk: null, fight_time: null, pause_count: null,
    duration_s: 60, spm: null, elapsed_s: null,
    overshots: null, reloads: null, damage_taken: null,
    hash: null, game_version: null, sens_raw: null, sens_scale: null,
    dpi: null, sens_increment: null, cm360: null, cfg_key: '30.0',
    fov: null, fov_scale: null, resolution: null, avg_fps: null,
    ...over,
  } as Run;
}

const timed = () => 'timed' as Shape;

describe('materialiseMarks', () => {
  it('is empty for a debut', () => {
    const marks = materialiseMarks([run({ id: 'a' })], timed);
    expect(marks.get('a')).toEqual({
      cfg: { best_before: null, played_before: 0 },
      any: { best_before: null, played_before: 0 },
    });
  });

  it('carries the best prior run and how many there were', () => {
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 100 }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 300 }),
      run({ id: 'c', started_at: '2026-01-03T00:00:00', score: 200 }),
    ], timed);
    expect(marks.get('c')!.cfg).toEqual({ best_before: 300, played_before: 2 });
    expect(marks.get('b')!.cfg).toEqual({ best_before: 100, played_before: 1 });
  });

  it('does not let one scenario mark another', () => {
    const marks = materialiseMarks([
      run({ id: 'a', scenario: 'S', started_at: '2026-01-01T00:00:00', score: 999 }),
      run({ id: 'b', scenario: 'T', started_at: '2026-01-02T00:00:00', score: 1 }),
    ], timed);
    expect(marks.get('b')!.cfg.played_before).toBe(0);
  });

  it('separates the same-sensitivity variant from the relaxed one', () => {
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900, cfg_key: '45.0' }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 100, cfg_key: '30.0' }),
    ], timed);
    expect(marks.get('b')!.cfg).toEqual({ best_before: null, played_before: 0 });
    expect(marks.get('b')!.any).toEqual({ best_before: 900, played_before: 1 });
  });

  it('ignores the sensitivity filter when the focused run has none', () => {
    // Mirrors the SQL: the filter applies only when there is something to
    // filter on.
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900, cfg_key: '45.0' }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 100, cfg_key: null }),
    ], timed);
    expect(marks.get('b')!.cfg).toEqual({ best_before: 900, played_before: 1 });
  });

  it('drops a prior run whose duration is out of tolerance', () => {
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900, duration_s: 30 }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 100, duration_s: 60 }),
    ], timed);
    expect(marks.get('b')!.cfg).toEqual({ best_before: null, played_before: 0 });
  });

  it('keeps a prior run with no duration at all', () => {
    // No .perf means no duration. Such a run still counts toward score
    // baselines; it simply cannot supply a curve.
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900, duration_s: null }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 100, duration_s: 60 }),
    ], timed);
    expect(marks.get('b')!.cfg).toEqual({ best_before: 900, played_before: 1 });
  });

  it('skips the duration filter entirely on a race', () => {
    // Duration is the score there, so filtering by it throws the comparison
    // away: on the slowest real Air Pure Medium run the tolerance floor
    // excludes its own PB.
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900, duration_s: 94 }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 910, duration_s: 81 }),
    ], () => 'race');
    expect(marks.get('b')!.cfg).toEqual({ best_before: 900, played_before: 1 });
  });

  it('counts a prior run whose score is missing but does not rank it', () => {
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: null }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 100 }),
    ], timed);
    expect(marks.get('b')!.cfg).toEqual({ best_before: null, played_before: 1 });
  });

  it('excludes a run with an identical timestamp from its twin', () => {
    // The SQL compares started_at strictly, and it has second resolution with
    // no uniqueness constraint.
    const marks = materialiseMarks([
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 900 }),
      run({ id: 'b', started_at: '2026-01-01T00:00:00', score: 100 }),
    ], timed);
    expect(marks.get('b')!.cfg.played_before).toBe(0);
  });

  it('does not care what order the runs arrive in', () => {
    // An out-of-order insert -- a restored backup, a re-pick -- must produce
    // the same marks as append order, which is why this is a fold over all
    // runs rather than something maintained incrementally.
    const rows = [
      run({ id: 'c', started_at: '2026-01-03T00:00:00', score: 200 }),
      run({ id: 'a', started_at: '2026-01-01T00:00:00', score: 100 }),
      run({ id: 'b', started_at: '2026-01-02T00:00:00', score: 300 }),
    ];
    expect(materialiseMarks(rows, timed).get('c')!.cfg)
      .toEqual({ best_before: 300, played_before: 2 });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && npx vitest run test/marks.test.ts`
Expected: `Failed to resolve import "../src/core/marks"`.

- [ ] **Step 4: Write the implementation**

Create `web/src/core/marks.ts`:

```ts
/** `best_before` and `played_before`, materialised.
 *
 * The rail's marks have to obey exactly the rules baseline selection obeys, or
 * the same pair of runs reads as a personal best in one panel and a loss in the
 * other. The Python expresses them once as SQL over the whole history; here
 * they are expressed once as this fold, and both the in-memory store and the
 * IndexedDB indexer call it.
 *
 * Materialised rather than computed per row because the browser design measured
 * the correlated-subquery equivalent at 296 ms against 4.2 ms over 12k runs.
 * Recomputing is a forward pass costing ~41 ms over that corpus, so the rule
 * can simply be: detect an out-of-order insert or a shape change, refold, done.
 */

import { DURATION_TOLERANCE } from './compare';
import { RACE } from './shapes';
import type { MarkSet, Run, RunMarks, Shape } from './types';

const EMPTY: MarkSet = { best_before: null, played_before: 0 };

export function materialiseMarks(
  runs: readonly Run[],
  shapeOf: (scenario: string) => Shape,
  durationTol: number = DURATION_TOLERANCE,
): Map<string, RunMarks> {
  const byScenario = new Map<string, Run[]>();
  for (const run of runs) {
    const group = byScenario.get(run.scenario);
    if (group) group.push(run);
    else byScenario.set(run.scenario, [run]);
  }

  const out = new Map<string, RunMarks>();
  for (const [scenario, group] of byScenario) {
    const isRace = shapeOf(scenario) === RACE;
    // Sorted by (started_at, id) rather than started_at alone: the timestamp
    // has second resolution and no uniqueness constraint, so time alone is not
    // a total order.
    const sorted = [...group].sort(
      (a, b) => (a.started_at < b.started_at ? -1
        : a.started_at > b.started_at ? 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    for (const focus of sorted) {
      const cfg: MarkSet = { ...EMPTY };
      const any: MarkSet = { ...EMPTY };
      for (const prior of sorted) {
        // Strictly earlier, matching the SQL. Two runs sharing a timestamp are
        // not priors of each other.
        if (!(prior.started_at < focus.started_at)) continue;
        // Duration is the score on a race, so judging peers by it throws the
        // comparison away.
        if (!isRace
          && focus.duration_s !== null && prior.duration_s !== null
          && Math.abs(prior.duration_s - focus.duration_s)
             > focus.duration_s * durationTol) continue;

        any.played_before += 1;
        if (prior.score !== null
          && (any.best_before === null || prior.score > any.best_before)) {
          any.best_before = prior.score;
        }

        // The sensitivity filter applies only when the focused run has a
        // sensitivity to filter on.
        if (focus.cfg_key !== null && prior.cfg_key !== focus.cfg_key) continue;
        cfg.played_before += 1;
        if (prior.score !== null
          && (cfg.best_before === null || prior.score > cfg.best_before)) {
          cfg.best_before = prior.score;
        }
      }
      out.set(focus.id, { cfg, any });
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd web && npx vitest run test/marks.test.ts`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/store.ts web/src/core/marks.ts web/test/marks.test.ts
git commit -m "Define the Store boundary and materialise the rail's marks

The Store interface is what lets the payload builder be checked against the
Python with no browser involved, and what lets Plan B swap IndexedDB in without
writing any comparison logic of its own.

The marks are a pure fold rather than a write-path detail so that the in-memory
store and the IndexedDB indexer run the same code -- the alternative has the
tests exercising an implementation that never ships."
```

---

### Task 11: Ingesting a run, and the in-memory Store

**Files:**
- Create: `web/src/core/ingest.ts`
- Create: `web/src/core/memstore.ts`
- Test: `web/test/memstore.test.ts`

**Interfaces:**
- Consumes: `statscsv.ts`, `perf.ts`, `scenario.ts`, `marks.ts`, `store.ts`.
- Produces:
  - `ingest(id, statsText, perfBytes?): Ingested` — one run, parsed. Plan B's indexer calls exactly this.
  - `buildStore(rows: readonly Ingested[]): Store`

`ingest` carries what `index.attach_perf` does after a successful parse (`index.py:189-214`), and those four effects are the contract:

- `has_perf` true, `duration_s` = the curve's duration or null when it is zero
- `spm` = `score / duration * 60`, null when the duration is unknown
- `damage_possible` = the sum of the curve's `dmg_possible` series — the CSV has no such summary key
- a `PerfError` leaves the run curve-less rather than failing it. Roughly one run in seven has no `.perf` at all, so curve-less is a supported state, not an error.

- [ ] **Step 1: Write the failing test**

Create `web/test/memstore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { readPerf, readStats, statsIds } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const SPECTRAL_B = 'Air Spectral Easy - Challenge - 2026.09.11-18.37.39';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';

const all = () => statsIds().map((id) => ingest(id, readStats(id), readPerf(id)));
const store = () => buildStore(all());

describe('ingest', () => {
  it('fills what only the curve knows', () => {
    const row = ingest(AIR_B, readStats(AIR_B), readPerf(AIR_B));
    expect(row.run.has_perf).toBe(true);
    expect(row.run.duration_s).toBeCloseTo(85.98716735839844, 10);
    expect(row.run.spm).toBeCloseTo(637.7688176588566, 8);
    // damage_possible is not a summary key; it comes from the curve.
    expect(row.run.damage_possible).toBe(8501);
    expect(row.curve!.buckets).toBe(86);
  });

  it('leaves a run without a .perf curve-less rather than failed', () => {
    const row = ingest(SPECTRAL_B, readStats(SPECTRAL_B), undefined);
    expect(row.run.has_perf).toBe(false);
    expect(row.run.duration_s).toBeNull();
    expect(row.run.spm).toBeNull();
    expect(row.curve).toBeNull();
    expect(row.error).toBeUndefined();
    expect(row.run.score).toBeCloseTo(927.416626, 6);
  });

  it('survives a truncated .perf and says why', () => {
    const bad = new Uint8Array([0x0a, 0x40, 0x01]);
    const row = ingest(AIR_B, readStats(AIR_B), bad);
    expect(row.run.has_perf).toBe(false);
    expect(row.curve).toBeNull();
    expect(row.error).toContain('truncated');
  });

  it('reads the kill rows', () => {
    expect(ingest(AIR_B, readStats(AIR_B), readPerf(AIR_B)).kills).toHaveLength(5);
    expect(ingest(TRACKING, readStats(TRACKING), readPerf(TRACKING)).kills).toEqual([]);
  });
});

describe('buildStore', () => {
  it('holds every run', () => {
    expect(store().counts()).toEqual({
      runs: 11, curves: 7, failed: 0, scenarios: 8,
    });
  });

  it('classifies each scenario over all of its runs', () => {
    const s = store();
    expect(s.getScenario('Air Pure Medium')!.shape).toBe('race');
    expect(s.getScenario('Air Spectral Easy')!.evidence).toBe('csv-constant-budget');
    expect(s.getScenario('VT Ground Intermediate S5')!.windowed).toBe(1);
    expect(s.getScenario('VT 1w2ts Horizontal Small')!.penalising).toBe(1);
  });

  it('serves the rail newest first, with its marks', () => {
    const rail = store().page(100, { sameCfg: true });
    expect(rail).toHaveLength(11);
    expect(rail[0]).toMatchObject({
      id: AIR_B, scenario: 'Air Pure Medium', shape: 'race',
      best_before: 906.138184, played_before: 1, buckets: 86,
    });
    expect(rail[1]).toMatchObject({
      id: SPECTRAL_B, best_before: 914.885254, played_before: 1, buckets: null,
    });
    expect(rail.map((r) => r.id)).toEqual([
      AIR_B, SPECTRAL_B, TRACKING,
      'Air Spectral Easy - Challenge - 2026.09.05-08.20.43',
      AIR_A,
      'Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01',
      'VT 1w2ts Horizontal Small - Challenge - 2026.06.22-18.48.41',
      GROUND_B, GROUND_A,
      'Happy Easter! - Challenge - 2026.04.06-18.13.05',
      '1w2ts Pasu Perfected Easy - Challenge - 2025.12.29-22.57.12',
    ]);
  });

  it('marks a run with no per-second data with a null bucket count', () => {
    // Roughly one run in seven. NULL is the marker the rail draws with, so it
    // must come from the absence of a curve rather than be inferred.
    const rail = store().page(100, { sameCfg: true });
    expect(rail.find((r) => r.id === SPECTRAL_B)!.buckets).toBeNull();
  });

  it('pages from a cursor without repeating or skipping', () => {
    const s = store();
    const first = s.page(3, { sameCfg: true });
    const next = s.page(3, { sameCfg: true, before: first[2].id });
    expect(first.map((r) => r.id)).not.toContain(next[0].id);
    expect(next[0].id).toBe('Air Spectral Easy - Challenge - 2026.09.05-08.20.43');
    expect(next).toHaveLength(3);
  });

  it('filters the rail by scenario', () => {
    const rail = store().page(100, { sameCfg: true, scenario: 'Air Pure Medium' });
    expect(rail.map((r) => r.id)).toEqual([AIR_B, AIR_A]);
  });

  it('picks peers by scenario, excluding the focused run', () => {
    const peers = store().candidates(AIR_B, {
      sameCfg: true, durationTol: 0.1, shape: 'race',
    });
    expect(peers.map((r) => r.id)).toEqual([AIR_A]);
  });

  it('skips the duration filter on a race', () => {
    // 85.99 s against 93.85 s is outside +-10%; on a timed scenario the peer
    // would be dropped, and on a race it must not be.
    const s = store();
    expect(s.candidates(AIR_B, { sameCfg: true, durationTol: 0.1, shape: 'race' }))
      .toHaveLength(1);
    expect(s.candidates(AIR_B, { sameCfg: true, durationTol: 0.1, shape: 'timed' }))
      .toHaveLength(0);
  });

  it('finds the best value per slot', () => {
    const s = store();
    const fastest = s.bestBySlot([AIR_A, AIR_B], 'ttk');
    expect(fastest.get(1)).toBeCloseTo(14.137001, 6);
    expect(fastest.get(5)).toBeCloseTo(20.050001, 6);
    const share = s.bestBySlot([GROUND_A, GROUND_B], 'share');
    expect(share.get(1)).toBeCloseTo(0.4465956140687721, 10);
    expect(share.get(3)).toBeCloseTo(0.35538311842688974, 10);
  });

  it('aggregates the scenario list newest-played first', () => {
    const list = store().scenarioList();
    expect(list.map((r) => r.scenario)).toEqual([
      'Air Pure Medium', 'Air Spectral Easy', 'Air Voltaic Invincible 4 Medium',
      'Pasu Voltaic Reload Easier', 'VT 1w2ts Horizontal Small',
      'VT Ground Intermediate S5', 'Happy Easter!', '1w2ts Pasu Perfected Easy',
    ]);
    expect(list[0]).toMatchObject({
      runs: 2, pb: 913.998901, shape: 'race',
      last_played: '2026-09-12T16:04:49',
    });
    expect(list[0].recent_form).toBeCloseTo(910.0685425, 6);
    expect(list[0].recent_elapsed).toBeCloseTo(89.92150000000038, 6);
    expect(list[0].pb_elapsed).toBeCloseTo(85.99399999999878, 6);
  });

  it('serves one day at a time, oldest first within the day', () => {
    const s = store();
    expect(s.day('2026-09-12').map((r) => r.id)).toEqual([AIR_B]);
    expect(s.day('2026-06-16').map((r) => r.id)).toEqual([GROUND_A, GROUND_B]);
    expect(s.day('1999-01-01')).toEqual([]);
    expect(s.days().at(-1)).toBe('2026-09-12');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/memstore.test.ts`
Expected: `Failed to resolve import "../src/core/ingest"`.

- [ ] **Step 3: Write `web/src/core/ingest.ts`**

```ts
/** Turning one run's files into rows.
 *
 * The unit both stores index with: the in-memory one here and the IndexedDB
 * one in Plan B. Keeping it shared is what stops the two drifting on the four
 * fields that only the curve knows.
 */

import { parsePerf, PerfError } from './perf';
import { parseKills, parseStats } from './statscsv';
import type { Curve, Kill, Run } from './types';

export interface Ingested {
  run: Run;
  curve: Curve | null;
  kills: Kill[];
  /** Why the `.perf` was rejected, when one was offered and failed. A parse
   *  that failed because the file was still being written is a retry, not a
   *  failure -- Plan B's `failed` store and its try budget consume this. */
  error?: string;
}

export function ingest(
  id: string, statsText: string, perfBytes?: Uint8Array,
): Ingested {
  const run = parseStats(id, statsText);
  const kills = parseKills(statsText);
  let curve: Curve | null = null;
  let error: string | undefined;

  if (perfBytes) {
    try {
      const parsed = parsePerf(perfBytes);
      curve = { buckets: parsed.buckets, duration_s: parsed.duration_s, series: parsed.series };
    } catch (e) {
      if (!(e instanceof PerfError)) throw e;
      error = e.message;
    }
  }

  if (curve) {
    run.has_perf = true;
    run.duration_s = curve.duration_s || null;
    run.spm = run.duration_s && run.score !== null
      ? (run.score / run.duration_s) * 60
      : null;
    // damage_possible is not a summary key; the curve is the only source.
    let possible = 0;
    for (const v of curve.series.dmg_possible) possible += v;
    run.damage_possible = possible;
  }

  return error === undefined ? { run, curve, kills } : { run, curve, kills, error };
}
```

- [ ] **Step 4: Write `web/src/core/memstore.ts`**

```ts
/** A Store held entirely in memory.
 *
 * Not a test double. It is how the oracle diff runs, and it is the read path
 * for a bootstrap whose database has not been written yet. Plan B's IndexedDB
 * store answers the same questions from disk.
 */

import type { Ingested } from './ingest';
import { materialiseMarks } from './marks';
import { refreshScenario, type ScenarioInput } from './scenario';
import { RACE } from './shapes';
import type {
  CandidateOpts, Counts, PageOpts, ScenarioListRow, SessionRow, SlotMetric, Store,
} from './store';
import type { Curve, Kill, RailRow, Run, RunMarks, Scenario, Shape } from './types';

const RECENT_FORM_N = 10;

function byTimeThenId(a: Run, b: Run): number {
  if (a.started_at !== b.started_at) return a.started_at < b.started_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildStore(rows: readonly Ingested[]): Store {
  const runs = new Map<string, Run>();
  const curves = new Map<string, Curve>();
  const kills = new Map<string, Kill[]>();
  let failed = 0;

  for (const row of rows) {
    runs.set(row.run.id, row.run);
    if (row.curve) curves.set(row.run.id, row.curve);
    kills.set(row.run.id, row.kills);
    if (row.error !== undefined) failed += 1;
  }

  // Classification is a fold over every run of a scenario, so it happens after
  // all of them are in. Doing it per run would classify a race scenario from
  // its first run alone, before the evidence that settles it has landed.
  const byScenario = new Map<string, ScenarioInput[]>();
  for (const row of rows) {
    const input: ScenarioInput = {
      run: row.run,
      score: row.curve?.series.score ?? null,
      kills: row.kills,
    };
    const group = byScenario.get(row.run.scenario);
    if (group) group.push(input);
    else byScenario.set(row.run.scenario, [input]);
  }
  const scenarios = new Map<string, Scenario>();
  for (const [name, inputs] of byScenario) {
    const scenario = refreshScenario(name, inputs);
    if (scenario) scenarios.set(name, scenario);
  }

  const shapeOf = (name: string): Shape => scenarios.get(name)?.shape ?? 'timed';
  const marks: Map<string, RunMarks> = materialiseMarks([...runs.values()], shapeOf);

  const newestFirst = [...runs.values()].sort((a, b) => -byTimeThenId(a, b));

  const railRow = (run: Run, sameCfg: boolean): RailRow => {
    const mark = marks.get(run.id)!;
    const set = sameCfg ? mark.cfg : mark.any;
    return {
      id: run.id,
      scenario: run.scenario,
      started_at: run.started_at,
      score: run.score,
      accuracy: run.accuracy,
      spm: run.spm,
      cfg_key: run.cfg_key,
      // NULL means no per-second data, which is what the rail draws with.
      buckets: curves.get(run.id)?.buckets ?? null,
      shape: scenarios.get(run.scenario)?.shape ?? null,
      best_before: set.best_before,
      played_before: set.played_before,
    };
  };

  const mean = (values: readonly number[]): number | null =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  return {
    getRun: (id) => runs.get(id),
    getScenario: (name) => scenarios.get(name),
    getCurve: (id) => curves.get(id),
    getKills: (id) => kills.get(id) ?? [],

    candidates(id: string, opts: CandidateOpts): Run[] {
      const focus = runs.get(id);
      if (!focus) throw new Error(`no such run: ${id}`);
      let rows = newestFirst
        .filter((r) => r.scenario === focus.scenario && r.id !== id)
        .sort(byTimeThenId);
      if (opts.sameCfg && focus.cfg_key !== null) {
        rows = rows.filter((r) => r.cfg_key === focus.cfg_key);
      }
      // Duration is the score on a race scenario, so filtering baselines by it
      // throws away the comparison.
      const target = focus.duration_s;
      if (target && opts.shape !== RACE) {
        rows = rows.filter((r) =>
          // Unknown duration means no .perf. Such a run still counts toward
          // score baselines; it simply cannot supply a curve.
          r.duration_s === null
          || Math.abs(r.duration_s - target) <= target * opts.durationTol);
      }
      return rows;
    },

    page(limit: number, opts: PageOpts): RailRow[] {
      let rows = newestFirst;
      if (opts.scenario) rows = rows.filter((r) => r.scenario === opts.scenario);
      if (opts.before != null) {
        const cursor = runs.get(opts.before);
        // The cursor is the whole (started_at, id) pair: started_at has second
        // resolution and no uniqueness constraint, so a cursor on time alone
        // would drop a run whose timestamp straddled a page boundary.
        if (cursor) rows = rows.filter((r) => byTimeThenId(r, cursor) < 0);
      }
      return rows.slice(0, limit).map((r) => railRow(r, opts.sameCfg));
    },

    bestBySlot(ids: readonly string[], metric: SlotMetric): Map<number, number> {
      const best = new Map<number, number>();
      for (const id of ids) {
        for (const kill of kills.get(id) ?? []) {
          let value: number | null;
          if (metric === 'ttk') {
            value = kill.ttk;
          } else {
            // No damage offered means no share, not a share of zero.
            value = kill.dmg_possible ? (kill.dmg_done ?? 0) / kill.dmg_possible : null;
          }
          if (value === null) continue;
          const current = best.get(kill.idx);
          const better = current === undefined
            || (metric === 'ttk' ? value < current : value > current);
          if (better) best.set(kill.idx, value);
        }
      }
      return best;
    },

    scenarioList(): ScenarioListRow[] {
      const out: ScenarioListRow[] = [];
      for (const [name, group] of byScenario) {
        const rows = group.map((g) => g.run).sort(byTimeThenId);
        const scored = rows.filter((r) => r.score !== null);
        const pb = scored.length ? Math.max(...scored.map((r) => r.score as number)) : null;
        // The PB run's elapsed, by score descending -- the same order the SQL
        // takes its LIMIT 1 in.
        const byScore = [...scored].sort((a, b) => (b.score as number) - (a.score as number));
        const recent = rows.slice(-RECENT_FORM_N);
        out.push({
          scenario: name,
          runs: rows.length,
          pb,
          last_played: rows[rows.length - 1].started_at,
          shape: scenarios.get(name)?.shape ?? null,
          pb_elapsed: byScore.length ? byScore[0].elapsed_s : null,
          recent_elapsed: mean(
            recent.map((r) => r.elapsed_s).filter((v): v is number => v !== null)),
          recent_form: mean(
            recent.map((r) => r.score).filter((v): v is number => v !== null)),
        });
      }
      return out.sort((a, b) => (a.last_played < b.last_played ? 1 : -1));
    },

    day(day: string): SessionRow[] {
      return newestFirst
        .filter((r) => r.started_at.slice(0, 10) === day)
        .sort(byTimeThenId)
        .map((r) => ({
          id: r.id, scenario: r.scenario, started_at: r.started_at,
          score: r.score, accuracy: r.accuracy, spm: r.spm,
        }));
    },

    days(): string[] {
      return [...new Set(newestFirst.map((r) => r.started_at.slice(0, 10)))].sort();
    },

    counts(): Counts {
      return {
        runs: runs.size, curves: curves.size, failed, scenarios: scenarios.size,
      };
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `cd web && npx vitest run test/memstore.test.ts`
Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/ingest.ts web/src/core/memstore.ts web/test/memstore.test.ts
git commit -m "Ingest a run, and serve one from memory

ingest() is the unit both stores index with, so the four fields only the curve
knows -- has_perf, duration, spm and damage_possible -- cannot drift between
them. The in-memory store is not a test double: it is how the oracle diff runs
and it is the read path before a database exists."
```

---

### Task 12: Baseline selection

**Files:**
- Create: `web/src/core/baselines.ts`
- Test: `web/test/baselines.test.ts`

**Interfaces:**
- Consumes: `store.ts`, `compare.ts`, `types.ts`.
- Produces:

```ts
export interface PbBaseline {
  run_id: string; score: number | null; started_at: string;
  is_true_pb: boolean; curve: Curve | null;
}
export interface Baselines {
  pb: PbBaseline | null;
  true_pb: { run_id: string; score: number | null; started_at: string } | null;
  recent: { n: number; mean_score: number | null; curve: Curve[] | null; run_ids: string[] | null };
  candidates: number;
}
export function baselines(store, id, opts): Baselines;
```

Port of `compare.baselines` (`compare.py:258-319`). Three rules and each has a test:

- **The overlay must be a run the chart can actually draw.** 35 of 316 real scenarios have a PB with no `.perf`, so `pb` falls back to the best *drawable* run and `true_pb` carries the real one. `Air Spectral Easy` has no `.perf` at all, so its `pb` is null while `true_pb` is not.
- **`recent` is the N most recent candidates started strictly before the focused run.** A negative or zero `recent_n` must yield none — Python's `prior[-0:]` is every prior run, which is a slice quirk rather than a request.
- **Curves and ids are built in one pass so they stay index-aligned.** A race curve is later resampled against its own run's `elapsed_s`; misaligning the two lists rescales a slow run onto someone else's clock.

- [ ] **Step 1: Write the failing test**

Create `web/test/baselines.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { baselines } from '../src/core/baselines';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { readPerf, readStats, statsIds } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const SPECTRAL_A = 'Air Spectral Easy - Challenge - 2026.09.05-08.20.43';
const SPECTRAL_B = 'Air Spectral Easy - Challenge - 2026.09.11-18.37.39';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const EASTER = 'Happy Easter! - Challenge - 2026.04.06-18.13.05';

const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));
const opts = { recentN: 10, sameCfg: true, durationTol: 0.1 };

describe('baselines', () => {
  it('resolves the PB and the recent form of a race run', () => {
    const b = baselines(store, AIR_B, { ...opts, shape: 'race' });
    expect(b.candidates).toBe(1);
    expect(b.true_pb).toEqual({
      run_id: AIR_A, score: 906.138184, started_at: '2026-09-03T19:08:37',
    });
    expect(b.pb!.run_id).toBe(AIR_A);
    expect(b.pb!.is_true_pb).toBe(true);
    expect(b.pb!.curve).not.toBeNull();
    expect(b.recent.n).toBe(1);
    expect(b.recent.mean_score).toBeCloseTo(906.138184, 6);
    expect(b.recent.run_ids).toEqual([AIR_A]);
  });

  it('has no recent form on the oldest run of a scenario', () => {
    const b = baselines(store, AIR_A, { ...opts, shape: 'race' });
    // The newer run is still a candidate and still the PB -- "recent" means
    // prior, but "best" means best.
    expect(b.candidates).toBe(1);
    expect(b.true_pb!.run_id).toBe(AIR_B);
    expect(b.pb!.run_id).toBe(AIR_B);
    expect(b.recent.n).toBe(0);
    expect(b.recent.mean_score).toBeNull();
    expect(b.recent.run_ids).toBeNull();
  });

  it('reports a true PB it cannot draw', () => {
    // Neither Air Spectral Easy run has a .perf, so there is a real PB and no
    // overlay. Presenting a non-PB as the PB is the failure this avoids.
    const b = baselines(store, SPECTRAL_A, { ...opts, shape: 'race' });
    expect(b.true_pb!.run_id).toBe(SPECTRAL_B);
    expect(b.pb).toBeNull();
    expect(b.recent.curve).toBeNull();
  });

  it('resolves a timed run against its prior', () => {
    const b = baselines(store, GROUND_B, { ...opts, shape: 'timed' });
    expect(b.true_pb!.run_id).toBe(GROUND_A);
    expect(b.pb!.run_id).toBe(GROUND_A);
    expect(b.recent.n).toBe(1);
    expect(b.recent.mean_score).toBe(1814);
    expect(b.recent.curve).toHaveLength(1);
    expect(b.recent.run_ids).toEqual([GROUND_A]);
  });

  it('keeps curves and their run ids index-aligned', () => {
    // A race curve is resampled against its own run's elapsed_s. Misaligning
    // these two lists rescales a slow run onto someone else's clock, which
    // hides it inside a band that looks normal.
    const b = baselines(store, AIR_B, { ...opts, shape: 'race' });
    expect(b.recent.curve).toHaveLength(b.recent.run_ids!.length);
    expect(b.recent.curve![0].buckets)
      .toBe(store.getCurve(b.recent.run_ids![0])!.buckets);
  });

  it('degrades to nothing for a scenario with one run', () => {
    const b = baselines(store, EASTER, { ...opts, shape: 'timed' });
    expect(b).toEqual({
      pb: null, true_pb: null,
      recent: { n: 0, mean_score: null, curve: null, run_ids: null },
      candidates: 0,
    });
  });

  it('treats a non-positive recent_n as none, not as all', () => {
    // Python's prior[-0:] is every prior run and a negative slice drops from
    // the front. Neither is a request; both are clamped.
    for (const recentN of [0, -5]) {
      expect(baselines(store, AIR_B, { ...opts, recentN, shape: 'race' }).recent.n)
        .toBe(0);
    }
  });

  it('drops peers at a different sensitivity when asked to', () => {
    const b = baselines(store, AIR_B, { ...opts, sameCfg: false, shape: 'race' });
    expect(b.candidates).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/baselines.test.ts`
Expected: `Failed to resolve import "../src/core/baselines"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/core/baselines.ts`:

```ts
/** Choosing what a run is judged against.
 *
 * Port of `compare.baselines`. The only thing it needs from storage is the
 * candidate set, and it takes that through the Store interface.
 */

import { DEFAULT_RECENT_N, DURATION_TOLERANCE } from './compare';
import type { Store } from './store';
import type { Curve, Shape } from './types';

export interface PbBaseline {
  run_id: string;
  score: number | null;
  started_at: string;
  is_true_pb: boolean;
  curve: Curve | null;
}

export interface Baselines {
  pb: PbBaseline | null;
  true_pb: { run_id: string; score: number | null; started_at: string } | null;
  recent: {
    n: number;
    mean_score: number | null;
    curve: Curve[] | null;
    run_ids: string[] | null;
  };
  candidates: number;
}

export interface BaselineOpts {
  recentN?: number;
  sameCfg?: boolean;
  durationTol?: number;
  shape?: Shape;
}

export function baselines(
  store: Store, id: string, opts: BaselineOpts = {},
): Baselines {
  const {
    recentN = DEFAULT_RECENT_N,
    sameCfg = true,
    durationTol = DURATION_TOLERANCE,
    shape = 'timed',
  } = opts;

  const focus = store.getRun(id);
  if (!focus) throw new Error(`no such run: ${id}`);
  const rows = store.candidates(id, { sameCfg, durationTol, shape });

  const result: Baselines = {
    pb: null,
    true_pb: null,
    recent: { n: 0, mean_score: null, curve: null, run_ids: null },
    candidates: rows.length,
  };
  if (!rows.length) return result;

  const scored = rows.filter((r) => r.score !== null);
  if (scored.length) {
    const truePb = scored.reduce((a, b) =>
      (b.score as number) > (a.score as number) ? b : a);
    result.true_pb = {
      run_id: truePb.id, score: truePb.score, started_at: truePb.started_at,
    };

    // The overlay must be a run we can actually draw. 35 of 316 real scenarios
    // have a PB with no .perf, so falling back is the norm.
    const drawable = scored.filter((r) => r.has_perf);
    if (drawable.length) {
      const pb = drawable.reduce((a, b) =>
        (b.score as number) > (a.score as number) ? b : a);
      result.pb = {
        run_id: pb.id,
        score: pb.score,
        started_at: pb.started_at,
        is_true_pb: pb.id === truePb.id,
        curve: store.getCurve(pb.id) ?? null,
      };
    }
  }

  const prior = rows.filter((r) => r.started_at < focus.started_at);
  // Clamp here rather than trusting a caller: a non-positive count is a slice
  // quirk in the Python, not a request for every prior run.
  const n = Math.max(recentN, 0);
  const recent = n ? prior.slice(-n) : [];
  if (recent.length) {
    result.recent.n = recent.length;
    const scores = recent
      .map((r) => r.score)
      .filter((s): s is number => s !== null);
    result.recent.mean_score = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    // Built in one pass so the two lists stay index-aligned -- a race curve is
    // later resampled against its own run's elapsed_s, not the focused run's.
    const curves: Curve[] = [];
    const runIds: string[] = [];
    for (const r of recent) {
      if (!r.has_perf) continue;
      const curve = store.getCurve(r.id);
      if (curve) {
        curves.push(curve);
        runIds.push(r.id);
      }
    }
    if (curves.length) {
      result.recent.curve = curves;
      result.recent.run_ids = runIds;
    }
  }
  return result;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run test/baselines.test.ts`
Expected: all passed.

- [ ] **Step 5: Run everything and type-check**

Run: `cd web && npm test && npx astro check`
Expected: all suites passed, `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/baselines.ts web/test/baselines.test.ts
git commit -m "Port baseline selection

The overlay falls back to the best run that has a curve, and true_pb carries
the real one, because 35 of 316 real scenarios have a PB with no .perf and
labelling a non-PB as the PB is worse than drawing nothing."
```

**REVIEW CHECKPOINT — stop here.** Everything the payload builder reads now exists and agrees with the Python. The remaining tasks are the builder itself.

---

### Task 13: The payload builder — skeleton and the timed path

**Files:**
- Create: `web/src/core/payload.ts`
- Test: `web/test/payload-timed.test.ts`

**Interfaces:**
- Consumes: `store.ts`, `baselines.ts`, `compare.ts`, `types.ts`.
- Produces: `buildRunPayload(store, id, opts?): Payload`, and the `Payload` type.

Port of `payload.build_run_payload` and `_fill_timed`. The race path is Task 14 and the bot windows are Task 15; this task leaves both as stubs that the next tasks fill, so the skeleton can be verified on its own.

Four rules with tests:

- **A race offers no metric buttons.** The shape fixes the y series, so all six buttons would redraw the identical line. `metric` stays a valid key on the query string so switching back to a timed run works.
- **`efficiency` is withheld where `dmg_possible < 0.5 * shots`** — the signature of a scenario that books damage only at kill time, where the per-second ratio is a flat zero rather than a measurement. Decided per run from the curve, not per scenario.
- **The delta is always in score units and always on the raw series.** Smoothing it would blur the invariant that its final value equals the score difference.
- **`marks.aligned` means the boundaries are the scenario's, not the player's.** True for a windowed timed scenario and for a race; false otherwise.

- [ ] **Step 1: Write the failing test**

Create `web/test/payload-timed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { buildRunPayload } from '../src/core/payload';
import { readPerf, readStats, statsIds } from './fixtures';

const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const RELOAD = 'Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';
const EASTER = 'Happy Easter! - Challenge - 2026.04.06-18.13.05';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';

const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));
const build = (id: string, o = {}) => buildRunPayload(store, id, o);

describe('buildRunPayload, timed', () => {
  it('carries the run, its scenario and a seconds axis', () => {
    const p = build(GROUND_B);
    expect(p.run.id).toBe(GROUND_B);
    expect(p.run.buckets).toBe(60);
    expect(p.run.score).toBe(2009);
    expect(p.scenario.shape).toBe('timed');
    expect(p.scenario.windowed).toBe(1);
    expect(p.axis).toEqual({ kind: 'time', label: 'seconds', n: 60 });
  });

  it('smooths the rate series but never the delta', () => {
    const p = build(GROUND_B);
    expect(p.rate.metric).toBe('score');
    expect(p.rate.unit).toBe('score');
    expect(p.rate.mine.slice(0, 4).map((v) => +v.toFixed(4)))
      .toEqual([52.6667, 49.5, 44.6, 40.2]);
    expect(p.delta.values!.slice(0, 4)).toEqual([34, 66, 54, 52]);
  });

  it('ends the delta exactly at the score difference', () => {
    const p = build(GROUND_B);
    expect(p.delta.unit).toBe('points');
    expect(p.delta.final).toBe(2009 - 1814);
    expect(p.delta.compare_until).toBe(60);
    expect(p.delta.baseline).toEqual({
      run_id: GROUND_A, score: 1814, is_true_pb: true,
    });
  });

  it('names the same baseline in the delta and in the headline', () => {
    const p = build(GROUND_B);
    expect(p.delta.baseline!.run_id).toBe(p.baselines.pb!.run_id);
  });

  it('marks a windowed scenario with shared, named boundaries', () => {
    const p = build(GROUND_B);
    expect(p.marks.aligned).toBe(true);
    expect(p.marks.labels).toEqual(['Ground 1 Bot', 'Ground 2 Bot', 'Ground 3 Bot']);
    expect(p.marks.kills.map((v) => +v.toFixed(3)))
      .toEqual([18.997, 39.398, 59.8]);
  });

  it('marks an ordinary scenario with the run\'s own kills, unaligned', () => {
    const p = build(RELOAD);
    expect(p.marks.aligned).toBe(false);
    expect(p.marks.labels).toEqual([]);
    expect(p.marks.kills).toHaveLength(52);
  });

  it('renders zero kill marks when nothing ever dies', () => {
    // 1090 of 2360 real runs have no kill rows. It is the normal case.
    const p = build(TRACKING);
    expect(p.marks.kills).toEqual([]);
    expect(p.splits).toEqual([]);
    expect(p.windows).toEqual([]);
  });

  it('offers efficiency only where damage is booked per tick', () => {
    // 5928 shots against 5.93 damage possible: the per-second ratio is a flat
    // zero rather than a measurement.
    expect(build(GROUND_B).metrics).toEqual(['score', 'shots', 'hits', 'kills', 'accuracy']);
    expect(build(RELOAD).metrics)
      .toEqual(['score', 'shots', 'hits', 'kills', 'accuracy', 'efficiency']);
  });

  it('offers no metric buttons at all on a race', () => {
    // The shape fixes the y series; six buttons would redraw one line.
    expect(build(AIR_B).metrics).toEqual([]);
  });

  it('computes a ratio metric per bucket', () => {
    const p = build(RELOAD, { metric: 'accuracy', smoothing: 0 });
    expect(p.rate.metric).toBe('accuracy');
    expect(p.rate.mine.slice(0, 6)).toEqual([0, 1, 1, 0, 1, 1]);
  });

  it('rejects a metric it does not know', () => {
    expect(() => build(GROUND_B, { metric: 'nonsense' })).toThrow(/unknown metric/);
  });

  it('rejects a run it does not have', () => {
    expect(() => build('no such run')).toThrow(/no such run/);
  });

  it('charts alone when there is nothing to compare against', () => {
    const p = build(EASTER);
    expect(p.axis.n).toBe(0);
    expect(p.rate.mine).toEqual([]);
    expect(p.rate.pb).toBeNull();
    expect(p.rate.band).toBeNull();
    expect(p.delta.values).toBeNull();
    expect(p.delta.final).toBeNull();
    expect(p.baselines.candidates).toBe(0);
  });

  it('draws no band when there is only one prior run', () => {
    // The band exists but collapses; with no prior run at all it is absent.
    expect(build(GROUND_A).rate.band).toBeNull();
    expect(build(GROUND_B).rate.band).not.toBeNull();
    expect(build(GROUND_B, { recentN: 0 }).rate.band).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/payload-timed.test.ts`
Expected: `Failed to resolve import "../src/core/payload"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/core/payload.ts`:

```ts
/** Building the payload the dashboard reads.
 *
 * Port of `aimcurve/payload.py`. The queries were the easy half; this is the
 * part that carries the decisions -- metric selection, smoothing, baseline
 * resolution, the tail marking, the dead-time residual, the weighted window
 * share. Every comment here records something learned from real data.
 */

import { baselines, type Baselines } from './baselines';
import {
  band as makeBand, compareUntil, cumulativeDelta, DEFAULT_RECENT_N,
  DURATION_TOLERANCE, raceDelta, raceGrid, resampleRace, smooth,
} from './compare';
import { RACE, TIMED } from './shapes';
import type { Store } from './store';
import type { Curve, Kill, Run, Scenario, SeriesName } from './types';

/** Metric name -> (numerator, denominator). Order is the button order. */
const METRICS: Record<string, [SeriesName, SeriesName | null]> = {
  score: ['score', null],
  shots: ['shots', null],
  hits: ['hits', null],
  kills: ['kills', null],
  accuracy: ['hits', 'shots'],
  efficiency: ['dmg_done', 'dmg_possible'],
};
const METRIC_ORDER = ['score', 'shots', 'hits', 'kills', 'accuracy', 'efficiency'];

export interface SplitRow {
  idx: number | null;
  bot: string;
  mine: number | null;
  base: number | null;
  best: number | null;
  delta: number | null;
  delta_adj: number | null;
}

export interface WindowRow {
  idx: number;
  bot: string;
  window_s: number | null;
  mine: number | null;
  base: number | null;
  best: number | null;
  recent: number | null;
  delta: number | null;
  delta_recent: number | null;
}

export interface Payload {
  run: Run & { buckets: number };
  scenario: Scenario;
  metrics: string[];
  axis: { kind: 'time' | 'progress'; label: string; n: number };
  rate: {
    metric: string;
    unit: string;
    mine: number[];
    pb: number[] | null;
    band: { mean: number[]; lo: number[]; hi: number[] } | null;
  };
  delta: {
    unit: 'points' | 'seconds';
    values: number[] | null;
    final: number | null;
    compare_until: number | null;
    baseline: { run_id: string; score: number | null; is_true_pb: boolean } | null;
  };
  marks: { kills: number[]; labels: string[]; aligned: boolean };
  splits: SplitRow[];
  windows: WindowRow[];
  window_summary: { mine: number | null; base: number | null } | null;
  baselines: {
    true_pb: Baselines['true_pb'];
    candidates: number;
    recent_n: number;
    recent_mean_score: number | null;
    pb: { run_id: string; score: number | null; started_at: string; is_true_pb: boolean } | null;
  };
}

export interface PayloadOpts {
  metric?: string;
  smoothing?: number;
  recentN?: number;
  sameCfg?: boolean;
}

function ratio(numerator: ArrayLike<number>, denominator: ArrayLike<number>): number[] {
  const out: number[] = [];
  const n = Math.min(numerator.length, denominator.length);
  for (let i = 0; i < n; i++) out.push(denominator[i] ? numerator[i] / denominator[i] : 0);
  return out;
}

function series(curve: Curve, metric: string): number[] {
  const [top, bottom] = METRICS[metric];
  if (bottom === null) return Array.from(curve.series[top]);
  return ratio(curve.series[top], curve.series[bottom]);
}

/** Which metric buttons are worth offering for this run.
 *
 * Damage is booked per tick on some scenarios and only at kill time on others.
 * Where it is per-kill, dmg_possible is a couple of units against thousands of
 * shots and `efficiency` draws a flat zero -- so it is withheld rather than
 * shown as though it were a measurement.
 */
function usableMetrics(curve: Curve | null): string[] {
  const usable = METRIC_ORDER.filter((name) => name !== 'efficiency');
  if (curve) {
    let possible = 0;
    let shots = 0;
    for (const v of curve.series.dmg_possible) possible += v;
    for (const v of curve.series.shots) shots += v;
    if (possible > 0 && possible >= 0.5 * shots) usable.push('efficiency');
  }
  return usable;
}

const DEFAULT_SCENARIO = (name: string): Scenario => ({
  name, shape: TIMED, penalising: 0, budget: null, pool: null, bots: null,
  clock_s: null, windowed: 0, evidence: 'default',
});

export function buildRunPayload(
  store: Store, id: string, opts: PayloadOpts = {},
): Payload {
  const {
    metric = 'score', smoothing = 5, recentN = DEFAULT_RECENT_N, sameCfg = true,
  } = opts;
  if (!(metric in METRICS)) throw new Error(`unknown metric: ${metric}`);

  const run = store.getRun(id);
  if (!run) throw new Error(`no such run: ${id}`);

  const scenario = store.getScenario(run.scenario) ?? DEFAULT_SCENARIO(run.scenario);
  const isRace = scenario.shape === RACE;

  const curve = store.getCurve(id) ?? null;
  const buckets = curve ? curve.series.score.length : 0;
  // A race plots damage/s whatever `metric` says -- the shape fixes the y
  // series, so every one of the six buttons would redraw the identical line.
  const metrics = isRace ? [] : usableMetrics(curve);

  const base = baselines(store, id, {
    recentN, sameCfg, durationTol: DURATION_TOLERANCE, shape: scenario.shape,
  });

  const payload: Payload = {
    run: { ...run, buckets },
    scenario,
    metrics,
    axis: { kind: 'time', label: 'seconds', n: buckets },
    rate: { metric, unit: metric, mine: [], pb: null, band: null },
    delta: { unit: 'points', values: null, final: null, compare_until: null, baseline: null },
    marks: { kills: [], labels: [], aligned: false },
    splits: [],
    windows: [],
    window_summary: null,
    baselines: {
      true_pb: base.true_pb,
      candidates: base.candidates,
      recent_n: base.recent.n,
      recent_mean_score: base.recent.mean_score,
      pb: base.pb === null ? null : {
        run_id: base.pb.run_id, score: base.pb.score,
        started_at: base.pb.started_at, is_true_pb: base.pb.is_true_pb,
      },
    },
  };

  if (isRace) fillRace(store, payload, run, scenario, curve, base, smoothing, sameCfg);
  else fillTimed(store, payload, run, scenario, curve, base, metric, smoothing, sameCfg);
  return payload;
}

/** Native per-second grid, score units -- plus bot windows where the scenario
 *  spends its clock on a rotation of bots that never die. */
function fillTimed(
  store: Store, payload: Payload, run: Run, scenario: Scenario,
  curve: Curve | null, base: Baselines, metric: string, smoothing: number,
  sameCfg: boolean,
): void {
  const mine = curve ? series(curve, metric) : [];
  payload.rate.mine = smooth(mine, smoothing);
  const kills = store.getKills(run.id);
  payload.marks.kills = kills.map((k) => k.t);
  // A window boundary is the scenario's, not the player's, so it falls at the
  // same second in every run. That is what `aligned` means to the chart.
  if (scenario.windowed) {
    payload.marks.aligned = true;
    payload.marks.labels = kills.map((k) => k.bot);
    payload.windows = botWindows(store, run, base, sameCfg);
    payload.window_summary = windowSummary(store, run, base);
  }

  if (curve && base.pb && base.pb.curve) {
    const pbCurve = base.pb.curve;
    payload.rate.pb = smooth(series(pbCurve, metric), smoothing);
    // Always score units, and always on the RAW series: smoothing would blur
    // the invariant that the final value equals the score difference.
    const mineScore = Array.from(curve.series.score);
    const baseScore = Array.from(pbCurve.series.score);
    const values = cumulativeDelta(mineScore, baseScore);
    payload.delta.values = values;
    payload.delta.final = values.length ? values[values.length - 1] : null;
    payload.delta.compare_until = compareUntil(mineScore, baseScore);
    // What the delta is measured against, so the UI cannot label the chart
    // with one baseline and the headline percentage with another.
    payload.delta.baseline = {
      run_id: base.pb.run_id, score: base.pb.score, is_true_pb: base.pb.is_true_pb,
    };
  }

  if (curve && base.recent.curve) {
    const raw = makeBand(base.recent.curve.map((c) => series(c, metric)));
    payload.rate.band = {
      mean: smooth(raw.mean, smoothing),
      lo: smooth(raw.lo, smoothing),
      hi: smooth(raw.hi, smoothing),
    };
  }
}

/** Filled in Task 14. */
function fillRace(
  _store: Store, _payload: Payload, _run: Run, _scenario: Scenario,
  _curve: Curve | null, _base: Baselines, _smoothing: number, _sameCfg: boolean,
): void {
  throw new Error('race path not implemented yet');
}

/** Filled in Task 15. */
function botWindows(
  _store: Store, _run: Run, _base: Baselines, _sameCfg: boolean,
): WindowRow[] {
  return [];
}

/** Filled in Task 15. */
function windowSummary(
  _store: Store, _run: Run, _base: Baselines,
): { mine: number | null; base: number | null } | null {
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run test/payload-timed.test.ts`
Expected: every test passes **except** the three that touch a windowed scenario's windows (`marks a windowed scenario...` passes; the window rows are asserted in Task 15) and the race-metrics one, which throws `race path not implemented yet`.

Mark those two as `it.todo` temporarily **only if** they fail for that reason, and restore them in Tasks 14 and 15. If any other test fails, the skeleton is wrong.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/payload.ts web/test/payload-timed.test.ts
git commit -m "Port the payload builder's timed path

The delta is computed on the raw score series and never on the smoothed one:
smoothing would blur the invariant that its final value equals the score
difference, which is the only thing stopping the chart and the headline
disagreeing. Efficiency is withheld per run rather than per scenario, from the
curve's own damage-to-shots ratio."
```

---

### Task 14: The payload builder — the race path and split table

**Files:**
- Modify: `web/src/core/payload.ts` (replace the `fillRace` stub, add `raceSplits`)
- Test: `web/test/payload-race.test.ts`

Port of `_fill_race` and `_race_splits`. Four rules with tests:

- **Kill k always lands at cumulative damage `k x pool/bots`**, so the marks are the same for every run of the scenario. That is the entire point of the progress axis.
- **Each recent run is resampled against its own `elapsed_s`**, never the focused run's. Scaling a band member onto someone else's clock moves a real Air Pure Medium run by up to ~15%, hiding a slow run inside a band that looks normal.
- **`compare_until` is 1.0.** Both runs span the whole pool by definition, so there is no region where only one has data and no shaded tail.
- **The split table must reconcile:** `sum(ttk) + dead = elapsed`. Dead time is this run's own residual, not a scenario constant — it is stable within a game version and moves by up to a second across versions.

`delta_adj` subtracts the run's own mean delta, so it sums to zero across the bots by construction and reads as "better or worse than the rest of this run". A plain delta ranks the bots you find hard; this ranks the bot that actually broke.

- [ ] **Step 1: Write the failing test**

Create `web/test/payload-race.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { buildRunPayload } from '../src/core/payload';
import { readPerf, readStats, statsIds } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const SPECTRAL_A = 'Air Spectral Easy - Challenge - 2026.09.05-08.20.43';

const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));
const build = (id: string, o = {}) => buildRunPayload(store, id, o);

describe('buildRunPayload, race', () => {
  it('charts against progress through the damage pool', () => {
    const p = build(AIR_B);
    expect(p.axis).toEqual({ kind: 'progress', label: '% of pool', n: 200 });
    expect(p.rate.metric).toBe('damage');
    expect(p.rate.unit).toBe('dmg/s');
    expect(p.rate.mine).toHaveLength(200);
    expect(p.rate.mine.slice(0, 4).map((v) => +v.toFixed(4)))
      .toEqual([89.0062, 88.8955, 88.7176, 88.5176]);
  });

  it('shares kill marks across every run of the scenario', () => {
    // Kill k lands at damage k*pool/bots in every run, so the boundaries
    // coincide. On a seconds axis they never would.
    const p = build(AIR_B);
    expect(p.marks.aligned).toBe(true);
    expect(p.marks.kills).toEqual([0.2, 0.4, 0.6, 0.8, 1.0]);
    expect(p.marks.labels).toEqual([
      'AIR1_Short_close', 'AIR1_Short_far', 'AIR2_Long3D_mid',
      'AIR2_Short_close', 'AIR2_Mid_UFO',
    ]);
  });

  it('measures the delta in seconds over the whole pool', () => {
    const p = build(AIR_B);
    expect(p.delta.unit).toBe('seconds');
    expect(p.delta.values).toHaveLength(200);
    expect(p.delta.values![0]).toBeCloseTo(0.086177, 6);
    expect(p.delta.final).toBeCloseTo(7.855, 6);
    // Both runs cover the whole pool by definition: no tail to shade.
    expect(p.delta.compare_until).toBe(1.0);
    expect(p.delta.baseline).toEqual({
      run_id: AIR_A, score: 906.138184, is_true_pb: true,
    });
  });

  it('lands within the CSV timestamp resolution of the score difference', () => {
    const p = build(AIR_B);
    const scoreDiff = 913.998901 - 906.138184;
    expect(Math.abs(p.delta.final! - scoreDiff)).toBeLessThan(0.02);
  });

  it('reconciles the split table', () => {
    // sum(ttk) + dead == elapsed. If this does not hold the code is wrong --
    // it catches a per-kill parse error, a dead-time sign error and a budget
    // error at once.
    const p = build(AIR_B);
    const bots = p.splits.filter((s) => s.idx !== null);
    const dead = p.splits.find((s) => s.idx === null)!;
    expect(bots).toHaveLength(5);
    expect(dead.bot).toBe('dead time');
    const total = bots.reduce((a, s) => a + (s.mine as number), 0) + (dead.mine as number);
    expect(total).toBeCloseTo(p.run.elapsed_s!, 6);
    expect(dead.mine).toBeCloseTo(1.044995, 5);
  });

  it('names the fastest each bot has ever gone down, this run included', () => {
    const p = build(AIR_B);
    expect(p.splits[0]).toMatchObject({ idx: 1, bot: 'AIR1_Short_close' });
    expect(p.splits[0].mine).toBeCloseTo(14.137001, 6);
    expect(p.splits[0].base).toBeCloseTo(15.48, 6);
    expect(p.splits[0].best).toBeCloseTo(14.137001, 6);
    expect(p.splits[0].delta).toBeCloseTo(-1.342999, 5);
  });

  it('adjusts each split by the run\'s own mean, so they sum to zero', () => {
    const p = build(AIR_B);
    const adj = p.splits
      .filter((s) => s.delta_adj !== null)
      .map((s) => s.delta_adj as number);
    expect(adj).toHaveLength(5);
    expect(adj.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
    expect(adj[0]).toBeCloseTo(0.2288008, 6);
    expect(adj[4]).toBeCloseTo(-6.6972012, 6);
  });

  it('reads the same dead-time pair from either side of the comparison', () => {
    // Symmetric by construction: each run's dead time is its own residual, so
    // swapping which run is focused swaps the two columns and nothing else.
    const p = build(AIR_A);
    const dead = p.splits.find((s) => s.idx === null)!;
    expect(dead.mine).toBeCloseTo(1.040996, 5);
    expect(dead.base).toBeCloseTo(1.044995, 5);
  });

  it('works on a race with no curve at all', () => {
    // Air Spectral Easy is classified from CSV totals; neither run has a
    // .perf. The axis, the marks and the split table still mean something.
    const p = build(SPECTRAL_A);
    expect(p.axis).toEqual({ kind: 'progress', label: '% of pool', n: 240 });
    expect(p.rate.mine).toEqual([]);
    expect(p.rate.pb).toBeNull();
    expect(p.delta.values).toBeNull();
    expect(p.marks.kills).toHaveLength(6);
    expect(p.splits.filter((s) => s.idx !== null)).toHaveLength(6);
  });

  it('builds the band from each run\'s own clock', () => {
    // Scaling a band member onto the focused run's clock moves a real run by
    // up to ~15%, which hides a slow run inside a band that looks normal.
    const p = build(AIR_B);
    expect(p.rate.band).not.toBeNull();
    expect(p.rate.band!.mean).toHaveLength(200);
    // One member, so the band collapses onto the PB's own resampled rate.
    expect(p.rate.band!.mean[0]).toBeCloseTo(p.rate.pb![0], 9);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/payload-race.test.ts`
Expected: every test fails with `race path not implemented yet`.

- [ ] **Step 3: Replace the `fillRace` stub and add `raceSplits`**

In `web/src/core/payload.ts`, replace the `fillRace` stub with:

```ts
/** Progress axis, damage rate, seconds-based delta, shared kill marks. */
function fillRace(
  store: Store, payload: Payload, run: Run, scenario: Scenario,
  curve: Curve | null, base: Baselines, smoothing: number, sameCfg: boolean,
): void {
  const bots = scenario.bots || 1;
  const steps = raceGrid(bots);
  payload.axis = { kind: 'progress', label: '% of pool', n: steps };
  payload.rate.metric = 'damage';
  payload.rate.unit = 'dmg/s';
  payload.delta.unit = 'seconds';
  // Kill k always lands at damage k*pool/bots, so the marks are the same for
  // every run of the scenario -- which is the whole point of this axis.
  payload.marks = {
    kills: Array.from({ length: bots }, (_, i) => (i + 1) / bots),
    labels: [],
    aligned: true,
  };

  let mineEdges: number[] = [];
  if (curve && run.elapsed_s) {
    const [edges, rate] = resampleRace(curve.series.hits, run.elapsed_s, steps);
    mineEdges = edges;
    payload.rate.mine = smooth(rate, smoothing);
  }

  const pbRun = base.pb ? store.getRun(base.pb.run_id) : undefined;
  if (mineEdges.length && base.pb?.curve && pbRun?.elapsed_s) {
    const [baseEdges, baseRate] = resampleRace(
      base.pb.curve.series.hits, pbRun.elapsed_s, steps);
    payload.rate.pb = smooth(baseRate, smoothing);
    const values = raceDelta(mineEdges, baseEdges);
    payload.delta.values = values;
    payload.delta.final = values.length ? values[values.length - 1] : null;
    // Both runs span the whole pool by definition, so there is no region where
    // only one of them has data.
    payload.delta.compare_until = 1.0;
    payload.delta.baseline = {
      run_id: base.pb.run_id, score: base.pb.score, is_true_pb: base.pb.is_true_pb,
    };
  }

  if (mineEdges.length && base.recent.curve && base.recent.run_ids) {
    const curves: number[][] = [];
    // Each recent run is resampled against its OWN elapsed_s, not the focused
    // run's: scaling every band member onto someone else's clock moves a real
    // Air Pure Medium run by up to ~15%, hiding a slow run inside a band that
    // looks normal.
    base.recent.curve.forEach((recent, i) => {
      const recentRun = store.getRun(base.recent.run_ids![i]);
      if (!recentRun?.elapsed_s) return;
      const [, recentRate] = resampleRace(
        recent.series.hits, recentRun.elapsed_s, steps);
      if (recentRate.length) curves.push(recentRate);
    });
    if (curves.length) {
      const raw = makeBand(curves);
      payload.rate.band = {
        mean: smooth(raw.mean, smoothing),
        lo: smooth(raw.lo, smoothing),
        hi: smooth(raw.hi, smoothing),
      };
    }
  }

  payload.splits = raceSplits(store, run, base, sameCfg);
  // Name the boundaries after the bots that hold them, reusing the rows the
  // split table already loaded. A run that quit early names fewer bots than the
  // scenario has; the chart falls back to the ordinal for the rest.
  payload.marks.labels = payload.splits
    .filter((s) => s.idx !== null)
    .map((s) => s.bot)
    .slice(0, bots);
}

/** Every run this one can fairly be judged against, and itself.
 *
 * Itself because `best` is a ceiling: on the run that set it the column has to
 * read that run's own number and the gap has to be zero, not blank.
 */
function peerIds(
  store: Store, run: Run, sameCfg: boolean, shape: Scenario['shape'],
): string[] {
  const rows = store.candidates(run.id, {
    sameCfg, durationTol: DURATION_TOLERANCE, shape,
  });
  return [...rows.map((r) => r.id), run.id];
}

/** Per-bot rows plus the dead-time residual, so the table reconciles.
 *
 * Dead time is not modelled as a scenario constant: it is stable within a game
 * version but moved by up to a second across versions, so it is carried as this
 * run's own residual and simply shown.
 */
function raceSplits(
  store: Store, run: Run, base: Baselines, sameCfg: boolean,
): SplitRow[] {
  const mine = store.getKills(run.id);
  if (!mine.length || !run.elapsed_s) return [];

  const baseByIdx = new Map<number, Kill>();
  if (base.pb) {
    for (const k of store.getKills(base.pb.run_id)) baseByIdx.set(k.idx, k);
  }

  // Fastest this bot has ever gone down, this run included.
  const best = store.bestBySlot(peerIds(store, run, sameCfg, RACE), 'ttk');

  const rows: SplitRow[] = mine.map((kill) => {
    const other = baseByIdx.get(kill.idx);
    return {
      idx: kill.idx,
      bot: kill.bot,
      mine: kill.ttk,
      base: other ? other.ttk : null,
      best: best.get(kill.idx) ?? null,
      delta: other && other.ttk !== null && kill.ttk !== null
        ? kill.ttk - other.ttk : null,
      delta_adj: null,
    };
  });

  // How much this bot cost you *over and above how the run went generally*. A
  // plain delta against the PB ranks the bots you find hard; subtracting the
  // run's own mean delta takes the bad-day component out and leaves the bot
  // that actually broke. Sums to zero across the bots by construction.
  const deltas = rows
    .map((r) => r.delta)
    .filter((d): d is number => d !== null);
  const meanDelta = deltas.length
    ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
  for (const row of rows) {
    row.delta_adj = row.delta === null || meanDelta === null
      ? null : row.delta - meanDelta;
  }

  const sumTtk = (kills: Iterable<Kill>) => {
    let total = 0;
    for (const k of kills) total += k.ttk ?? 0;
    return total;
  };

  const mineDead = run.elapsed_s - sumTtk(mine);
  let baseDead: number | null = null;
  if (baseByIdx.size && base.pb) {
    const baseRun = store.getRun(base.pb.run_id);
    if (baseRun?.elapsed_s) baseDead = baseRun.elapsed_s - sumTtk(baseByIdx.values());
  }
  // Dead time is the gap between bots, not a bot: it is part of the total but
  // it has no place in a ranking of which bot to work on.
  rows.push({
    idx: null, bot: 'dead time', mine: mineDead, base: baseDead, best: null,
    delta_adj: null,
    delta: baseDead === null ? null : mineDead - baseDead,
  });
  return rows;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run test/payload-race.test.ts test/payload-timed.test.ts`
Expected: all passed, including the race-metrics test in the timed file that was previously throwing.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/payload.ts web/test/payload-race.test.ts web/test/payload-timed.test.ts
git commit -m "Port the payload builder's race path

The progress axis is the point: kill k lands at damage k*pool/bots in every
run, so boundaries that never align on a seconds axis align here for free.
Band members are resampled against their own elapsed_s -- rescaling onto the
focused run's clock moves a real run by up to 15% and hides a slow one inside a
normal-looking band."
```

---

### Task 15: Bot windows

**Files:**
- Modify: `web/src/core/payload.ts` (replace the `botWindows` and `windowSummary` stubs)
- Test: `web/test/payload-windows.test.ts`

Port of `_bot_windows` and `_window_summary`. Some fixed-clock scenarios spend that clock on a rotation of bots that never die; the scenario, not the player, decides when each window ends.

Two rules with tests:

- **The metric is share of the damage the window offered, not raw damage.** Raw damage is unreadable across scenarios — 0.009 a window on one, 0.86 on another — and the window is a fixed length, so the damage it offers is a constant. The share you took is the same number in every scenario, and it is what the window was for.
- **The whole-run summary is damage taken over damage offered, not the mean of the per-window shares.** The windows are not all the same length — 18.99 s against 20.39 s on the VT scenarios — so an unweighted mean over-counts the short one.

`recent` uses the same recent-N the chart's band is built from, so the stepper moves both and the two cannot disagree about what "recent" means.

- [ ] **Step 1: Write the failing test**

Create `web/test/payload-windows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { buildRunPayload } from '../src/core/payload';
import { readPerf, readStats, statsIds } from './fixtures';

const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';
const RELOAD = 'Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01';

const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));
const build = (id: string, o = {}) => buildRunPayload(store, id, o);

describe('bot windows', () => {
  it('reports each window as a share of the damage it offered', () => {
    const p = build(GROUND_B);
    expect(p.windows).toHaveLength(3);
    expect(p.windows[0]).toMatchObject({ idx: 1, bot: 'Ground 1 Bot' });
    expect(p.windows[0].window_s).toBeCloseTo(18.993, 6);
    expect(p.windows[0].mine).toBeCloseTo(0.4465956140687721, 12);
    expect(p.windows[0].base).toBeCloseTo(0.29825678986109133, 12);
    expect(p.windows[0].delta).toBeCloseTo(0.14833882420768074, 12);
  });

  it('names the most of a window anyone has taken, this run included', () => {
    const p = build(GROUND_B);
    expect(p.windows[0].best).toBeCloseTo(0.4465956140687721, 12);
    // The third window was better on the other run, so the ceiling is theirs.
    expect(p.windows[2].best).toBeCloseTo(0.35538311842688974, 12);
  });

  it('uses the same recent set the band is built from', () => {
    const p = build(GROUND_B);
    expect(p.windows[0].recent).toBeCloseTo(0.29825678986109133, 12);
    expect(p.windows[0].delta_recent).toBeCloseTo(0.14833882420768074, 12);
    // Move the stepper and both move together.
    expect(build(GROUND_B, { recentN: 0 }).windows[0].recent).toBeNull();
  });

  it('weights the whole-run summary by damage, not by window', () => {
    // The windows are 18.99 s and 20.39 s, so an unweighted mean of the three
    // shares over-counts the short one.
    const p = build(GROUND_B);
    expect(p.window_summary).not.toBeNull();
    expect(p.window_summary!.mine).toBeCloseTo(0.3358887148407242, 12);
    expect(p.window_summary!.base).toBeCloseTo(0.3070336947352315, 12);
    const unweighted = p.windows.reduce((a, w) => a + (w.mine as number), 0) / 3;
    expect(p.window_summary!.mine).not.toBeCloseTo(unweighted, 6);
  });

  it('reverses cleanly when the baseline is the other run', () => {
    const p = build(GROUND_A);
    expect(p.window_summary!.mine).toBeCloseTo(0.3070336947352315, 12);
    expect(p.window_summary!.base).toBeCloseTo(0.3358887148407242, 12);
  });

  it('is absent on a scenario whose bots actually die', () => {
    const p = build(RELOAD);
    expect(p.windows).toEqual([]);
    expect(p.window_summary).toBeNull();
    expect(p.marks.aligned).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/payload-windows.test.ts`
Expected: failures reporting `[]` where window rows were expected.

- [ ] **Step 3: Replace both stubs**

In `web/src/core/payload.ts`, replace the `botWindows` and `windowSummary` stubs with:

```ts
/** Damage taken over damage offered, for one kill row. Null when the window
 *  offered no damage -- which is not the same as a share of zero. */
function share(kill: Kill | undefined): number | null {
  if (!kill || !kill.dmg_possible) return null;
  return (kill.dmg_done ?? 0) / kill.dmg_possible;
}

/** Whole-run share for this run and for the PB run.
 *
 * Damage taken over damage offered, not the mean of the per-window shares: the
 * windows are not all the same length -- 18.99 s against 20.39 s on the VT
 * scenarios -- so an unweighted mean over-counts the short one.
 */
function windowSummary(
  store: Store, run: Run, base: Baselines,
): { mine: number | null; base: number | null } {
  const overall = (runId: string): number | null => {
    let done = 0;
    let possible = 0;
    for (const k of store.getKills(runId)) {
      if (k.dmg_done !== null) done += k.dmg_done;
      if (k.dmg_possible) possible += k.dmg_possible;
    }
    return possible ? done / possible : null;
  };
  return {
    mine: overall(run.id),
    base: base.pb ? overall(base.pb.run_id) : null,
  };
}

/** Per-bot share of the damage its window made available.
 *
 * Raw damage is unreadable across scenarios -- 0.009 a window on Plink Palace
 * against 0.86 on Aether -- and the window is a fixed length, so the damage it
 * offers is a constant. The share of it you took is the same number in every
 * scenario, and it is what the window was for.
 */
function botWindows(
  store: Store, run: Run, base: Baselines, sameCfg: boolean,
): WindowRow[] {
  const kills = store.getKills(run.id);
  if (!kills.length) return [];

  const baseByIdx = new Map<number, Kill>();
  if (base.pb) {
    for (const k of store.getKills(base.pb.run_id)) baseByIdx.set(k.idx, k);
  }

  // The same recent-N the chart's band is built from, so the stepper moves both
  // and the two cannot disagree about what "recent" means.
  const recentByIdx = new Map<number, number[]>();
  for (const recentId of base.recent.run_ids ?? []) {
    for (const k of store.getKills(recentId)) {
      const value = share(k);
      if (value === null) continue;
      const pool = recentByIdx.get(k.idx);
      if (pool) pool.push(value);
      else recentByIdx.set(k.idx, [value]);
    }
  }

  // The most of this window anyone has taken, this run included.
  const best = store.bestBySlot(peerIds(store, run, sameCfg, TIMED), 'share');

  return kills.map((kill) => {
    const mine = share(kill);
    const against = share(baseByIdx.get(kill.idx));
    const pool = recentByIdx.get(kill.idx) ?? [];
    const recent = pool.length ? pool.reduce((a, b) => a + b, 0) / pool.length : null;
    return {
      idx: kill.idx,
      bot: kill.bot,
      window_s: kill.ttk,
      mine,
      base: against,
      best: best.get(kill.idx) ?? null,
      recent,
      delta: mine === null || against === null ? null : mine - against,
      delta_recent: mine === null || recent === null ? null : mine - recent,
    };
  });
}
```

Note that `windowSummary` no longer returns null — `fillTimed` only calls it when `scenario.windowed`, and the payload's default is already null. Confirm the declared return type in `fillTimed` still matches.

- [ ] **Step 4: Run the whole suite**

Run: `cd web && npm test && npx astro check`
Expected: all suites passed, `0 errors`.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/payload.ts web/test/payload-windows.test.ts
git commit -m "Port the bot window panel

Share of the damage a window offered, not raw damage: the window is a fixed
length so the damage it offers is a constant, and the share is the same number
in every scenario. The whole-run figure is weighted by damage rather than
averaged over windows, which are not all the same length."
```

---

### Task 16: The API surface

**Files:**
- Create: `web/src/core/api.ts`
- Test: `web/test/api.test.ts`

**Interfaces:**
- Consumes: `store.ts`, `payload.ts`.
- Produces the five functions that answer exactly what `app.js` asks for today, so Plan B's `api()` shim is a routing table and nothing more:

```ts
getRuns(store, opts): RailRow[]                      // GET /api/runs
getRun(store, id, opts): Payload                     // GET /api/run/<id>
getScenarios(store): ScenarioListRow[]               // GET /api/scenarios
getSession(store, day?): { day: string | null; runs: SessionRow[] }
getHealth(store): Health                             // GET /api/health
```

`getSession` with no day answers with the most recent day that has runs, matching `MAX(substr(started_at,1,10))` in the Python.

- [ ] **Step 1: Write the failing test**

Create `web/test/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getHealth, getRun, getRuns, getScenarios, getSession } from '../src/core/api';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { readPerf, readStats, statsIds } from './fixtures';

const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';

const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));

describe('api', () => {
  it('serves the rail with a default limit', () => {
    expect(getRuns(store, {})).toHaveLength(11);
    expect(getRuns(store, { limit: 2 })).toHaveLength(2);
    expect(getRuns(store, {})[0].id).toBe(AIR_B);
  });

  it('serves one run', () => {
    expect(getRun(store, AIR_B, {}).run.id).toBe(AIR_B);
  });

  it('serves the scenario list', () => {
    expect(getScenarios(store)).toHaveLength(8);
    expect(getScenarios(store)[0].scenario).toBe('Air Pure Medium');
  });

  it('defaults the session to the most recent day with runs', () => {
    const s = getSession(store);
    expect(s.day).toBe('2026-09-12');
    expect(s.runs.map((r) => r.id)).toEqual([AIR_B]);
  });

  it('serves a named day', () => {
    expect(getSession(store, '2026-06-16').runs.map((r) => r.id))
      .toEqual([GROUND_A, GROUND_B]);
  });

  it('answers an empty day without inventing one', () => {
    const s = getSession(store, '1999-01-01');
    expect(s).toEqual({ day: '1999-01-01', runs: [] });
  });

  it('reports health', () => {
    expect(getHealth(store)).toEqual({
      runs: 11, curves: 7, failed: 0, scenarios: 8,
      awaiting_perf: 0, watcher_errors: 0,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/api.test.ts`
Expected: `Failed to resolve import "../src/core/api"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/core/api.ts`:

```ts
/** What the dashboard asks for.
 *
 * These are exactly the five endpoints `app.js` fetches today, with the same
 * payload shapes. Keeping the shapes identical is what lets the oracle diff
 * compare the Python and this directly, and it is what reduces Plan B's wiring
 * to a routing table.
 */

import { buildRunPayload, type Payload, type PayloadOpts } from './payload';
import type { ScenarioListRow, SessionRow, Store } from './store';
import type { RailRow } from './types';

const DEFAULT_LIMIT = 50;

export interface RunsOpts {
  limit?: number;
  scenario?: string | null;
  before?: string | null;
  sameCfg?: boolean;
}

export interface Health {
  runs: number;
  curves: number;
  failed: number;
  scenarios: number;
  /** Runs indexed from their CSV whose `.perf` has not arrived. Always 0 until
   *  Plan B adds an observer; the field exists so the shape does not change. */
  awaiting_perf: number;
  watcher_errors: number;
}

export function getRuns(store: Store, opts: RunsOpts): RailRow[] {
  const { limit = DEFAULT_LIMIT, scenario = null, before = null, sameCfg = true } = opts;
  return store.page(limit, { scenario, before, sameCfg });
}

export function getRun(store: Store, id: string, opts: PayloadOpts): Payload {
  return buildRunPayload(store, id, opts);
}

export function getScenarios(store: Store): ScenarioListRow[] {
  return store.scenarioList();
}

export function getSession(
  store: Store, day?: string,
): { day: string | null; runs: SessionRow[] } {
  const days = store.days();
  const target = day ?? days[days.length - 1] ?? null;
  return { day: target, runs: target === null ? [] : store.day(target) };
}

export function getHealth(store: Store): Health {
  return { ...store.counts(), awaiting_perf: 0, watcher_errors: 0 };
}
```

- [ ] **Step 4: Run the whole suite**

Run: `cd web && npm test && npx astro check`
Expected: all suites passed, `0 errors`.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/api.ts web/test/api.test.ts
git commit -m "Expose the five endpoints the dashboard asks for

Same names, same payload shapes as the Python's HTTP API, so the oracle can
diff them directly and Plan B's wiring is a routing table rather than a
translation layer."
```

**REVIEW CHECKPOINT — stop here.** The engine is complete. The last task proves it.

---

### Task 17: The oracle diff

**Files:**
- Create: `web/vitest.oracle.config.ts`
- Create: `web/test/oracle/diff.ts`
- Create: `web/test/oracle/diff.test.ts`
- Modify: `web/vitest.config.ts` (exclude `test/oracle/`)
- Modify: `web/package.json` (add the `oracle` script)
- Modify: `README.md`

This is Plan A's exit criterion. It runs the frozen Python over the fixtures, runs the TypeScript over the same fixtures, and compares every field of every payload.

**It must never skip.** If Python cannot be reached, the run fails. A differential test that silently passes when it could not reach one side reports green over nothing, which is the failure mode the README already warns about for `drive-client.mjs`.

**Three normalisations, and only three.** Anything else that differs is a defect:

1. **`id`.** The Python's is a row counter; the TypeScript's is a basename. The dump's `ids` map translates.
2. **`stats_file` and `perf_file`.** The browser has no absolute paths. Both are dropped from the Python side, and `perf_file !== null` becomes `has_perf`.
3. **Floats compare with a relative tolerance of `1e-12`** (absolute `1e-9` near zero). `statistics.fmean` and `pstdev` sum with `math.fsum`, which is exactly rounded; naive JS summation is not. Everything else — strings, integers, nulls, array lengths, key sets, array order — compares exactly.

- [ ] **Step 1: Split the Vitest configs**

In `web/vitest.config.ts`, add the exclusion so the default run stays offline:

```ts
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The oracle diff needs Python and is run on its own with `npm run oracle`.
    // Keeping it out of the default run means `npm test` never depends on a
    // toolchain the browser app does not have.
    exclude: ['test/oracle/**', 'node_modules/**'],
    environment: 'node',
  },
});
```

Create `web/vitest.oracle.config.ts`:

```ts
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    include: ['test/oracle/**/*.test.ts'],
    environment: 'node',
    // The Python dump indexes eleven runs into a throwaway database; on a cold
    // nix store the first invocation also fetches an interpreter.
    testTimeout: 120_000,
  },
});
```

Add to `web/package.json` scripts:

```json
"oracle": "vitest run --config vitest.oracle.config.ts"
```

- [ ] **Step 2: Write the comparison helper**

Create `web/test/oracle/diff.ts`:

```ts
/** Comparing two JSON documents field by field. */

const REL_TOLERANCE = 1e-12;
const ABS_TOLERANCE = 1e-9;

export interface Difference {
  path: string;
  python: unknown;
  typescript: unknown;
}

function close(a: number, b: number): boolean {
  if (Object.is(a, b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(ABS_TOLERANCE, scale * REL_TOLERANCE);
}

export function compare(
  python: unknown, typescript: unknown, path = '', out: Difference[] = [],
): Difference[] {
  if (typeof python === 'number' && typeof typescript === 'number') {
    if (!close(python, typescript)) out.push({ path, python, typescript });
    return out;
  }
  if (Array.isArray(python) || Array.isArray(typescript)) {
    if (!Array.isArray(python) || !Array.isArray(typescript)
      || python.length !== typescript.length) {
      out.push({ path, python, typescript });
      return out;
    }
    python.forEach((v, i) => compare(v, typescript[i], `${path}[${i}]`, out));
    return out;
  }
  if (python && typescript && typeof python === 'object' && typeof typescript === 'object') {
    const pk = Object.keys(python as object).sort();
    const tk = Object.keys(typescript as object).sort();
    if (pk.join(',') !== tk.join(',')) {
      out.push({ path: `${path}{keys}`, python: pk, typescript: tk });
      return out;
    }
    for (const key of pk) {
      compare(
        (python as Record<string, unknown>)[key],
        (typescript as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        out,
      );
    }
    return out;
  }
  if (python !== typescript) out.push({ path, python, typescript });
  return out;
}

/** Rewrite a Python-side document so that only real disagreements remain.
 *
 * Three normalisations, and only three -- see the plan. `ids` maps the Python's
 * row counters onto basenames.
 */
export function normalisePython(
  doc: Record<string, any>,
): Record<string, unknown> {
  const ids: Record<string, string> = doc.ids;
  const name = (rowId: number | string): string => {
    const mapped = ids[String(rowId)];
    if (mapped === undefined) throw new Error(`no basename for python id ${rowId}`);
    return mapped;
  };

  const run = (r: Record<string, any>) => {
    const { stats_file, perf_file, id, ...rest } = r;
    return { ...rest, id: name(id), has_perf: perf_file !== null };
  };

  const runs: Record<string, unknown> = {};
  for (const [rowId, payload] of Object.entries<any>(doc.runs)) {
    const p = { ...payload, run: run(payload.run) };
    if (p.delta.baseline) {
      p.delta = { ...p.delta, baseline: { ...p.delta.baseline, run_id: name(p.delta.baseline.run_id) } };
    }
    p.baselines = { ...p.baselines };
    if (p.baselines.true_pb) {
      p.baselines.true_pb = { ...p.baselines.true_pb, run_id: name(p.baselines.true_pb.run_id) };
    }
    if (p.baselines.pb) {
      p.baselines.pb = { ...p.baselines.pb, run_id: name(p.baselines.pb.run_id) };
    }
    runs[name(rowId)] = p;
  }

  return {
    runs,
    rail: doc.rail.map((r: any) => ({ ...r, id: name(r.id) })),
    scenarios: doc.scenarios,
    days: Object.fromEntries(
      Object.entries<any[]>(doc.days).map(([day, rows]) =>
        [day, rows.map((r) => ({ ...r, id: name(r.id) }))]),
    ),
  };
}
```

- [ ] **Step 3: Write the diff test**

Create `web/test/oracle/diff.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getRun, getRuns, getScenarios } from '../../src/core/api';
import { ingest } from '../../src/core/ingest';
import { buildStore } from '../../src/core/memstore';
import type { Store } from '../../src/core/store';
import { readPerf, readStats, statsIds } from '../fixtures';
import { compare, normalisePython, type Difference } from './diff';

// Reached with `nix shell nixpkgs#python3 --command python3` on the development
// machine; set AIMCURVE_PYTHON to whatever invokes Python 3 elsewhere. There is
// deliberately no skip: a differential test that passes when it could not reach
// one side reports green over nothing.
const PYTHON = process.env.AIMCURVE_PYTHON ?? 'python3';
const REPO = new URL('../../../', import.meta.url).pathname;

let python: Record<string, unknown>;
let store: Store;

function dumpFromPython(): Record<string, any> {
  const dir = mkdtempSync(join(tmpdir(), 'aimcurve-oracle-'));
  const out = join(dir, 'oracle.json');
  try {
    execFileSync(PYTHON, ['-m', 'aimcurve', 'dump', '--root', 'tests/fixtures', '--out', out],
      { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The same document `dump.build` produces, from the TypeScript. */
function dumpFromTypescript(s: Store) {
  const runs: Record<string, unknown> = {};
  for (const id of statsIds()) runs[id] = getRun(s, id, {});
  return {
    runs,
    rail: getRuns(s, { limit: 100_000 }),
    scenarios: getScenarios(s),
    days: Object.fromEntries(s.days().map((d) => [d, s.day(d)])),
  };
}

function report(differences: Difference[]): string {
  return differences
    .slice(0, 40)
    .map((d) => `  ${d.path}\n    python: ${JSON.stringify(d.python)}\n    ts:     ${JSON.stringify(d.typescript)}`)
    .join('\n');
}

beforeAll(() => {
  python = normalisePython(dumpFromPython());
  store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));
}, 120_000);

describe('oracle diff', () => {
  it('reached the Python at all', () => {
    expect(Object.keys(python.runs as object)).toHaveLength(11);
  });

  it('agrees on every run payload', () => {
    const mine = dumpFromTypescript(store);
    const differences = compare((python as any).runs, mine.runs, 'runs');
    expect(differences, `\n${report(differences)}`).toEqual([]);
  });

  it('agrees on the rail', () => {
    const differences = compare((python as any).rail, dumpFromTypescript(store).rail, 'rail');
    expect(differences, `\n${report(differences)}`).toEqual([]);
  });

  it('agrees on the scenario list', () => {
    const differences = compare(
      (python as any).scenarios, dumpFromTypescript(store).scenarios, 'scenarios');
    expect(differences, `\n${report(differences)}`).toEqual([]);
  });

  it('agrees on every day', () => {
    const differences = compare((python as any).days, dumpFromTypescript(store).days, 'days');
    expect(differences, `\n${report(differences)}`).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the diff**

Run: `cd web && AIMCURVE_PYTHON="python3" npm run oracle`

On the development machine, where Python comes from nix:

```bash
cd /home/voidfill/git/aimcurve
nix shell nixpkgs#python3 --command bash -c 'cd web && npm run oracle'
```

Expected: 5 passed.

**If it does not pass, the differences are the work.** Read the reported paths: each names a field, the Python's value, and the TypeScript's. Fix the TypeScript — the Python is the oracle. Do not widen the tolerance and do not add a normalisation. If a disagreement genuinely cannot be resolved without a fourth normalisation, stop and raise it; that is a design question, not an implementation detail.

- [ ] **Step 5: Document both commands**

In `README.md`, replace the `## Tests` section with:

````markdown
## Tests

The Python:

```
python -m unittest discover -s tests
```

The browser engine, offline and with no Python involved:

```
cd web && npm test
```

And the differential check, which runs both and compares every field of every
payload over the fixtures:

```
cd web && npm run oracle
```

It never skips. If it cannot reach Python it fails, because a differential test
that passes when it could only run one side reports green over nothing. Set
`AIMCURVE_PYTHON` if `python3` is not what launches it.

What none of these cover is the browser: IndexedDB, the directory picker, and
the rendering. Those want eyes on the page.
````

- [ ] **Step 6: Commit**

```bash
git add web/vitest.config.ts web/vitest.oracle.config.ts web/test/oracle web/package.json README.md
git commit -m "Diff the browser engine against the Python over every fixture

Plan A's exit criterion. Three normalisations and only three: the row-counter
id, the absolute paths the browser does not have, and a float tolerance for the
aggregates Python sums with fsum. Anything else that differs is a defect.

It cannot skip. A differential test that passes when it could not reach one
side reports green over nothing."
```

---

## Done when

- `cd web && npm test` passes with no Python present.
- `cd web && npm run oracle` passes: every payload, the rail, the scenario list
  and every day agree with the frozen Python over all 11 stats fixtures and 7
  `.perf` fixtures.
- `nix shell nixpkgs#python3 --command python3 -m unittest discover -s tests`
  still passes — Plan A deleted nothing, so `python -m aimcurve` still runs.
- `cd web && npx astro check` reports 0 errors.

What is deliberately **not** proven here, and moves to Plan B and to the
integration pass: IndexedDB, both sources, the UI, and the full-corpus diff
against a real install — including the banker's-rounding tie on `cfg_key`,
non-ASCII scenario names, and malformed CSVs, none of which the fixture corpus
contains.
