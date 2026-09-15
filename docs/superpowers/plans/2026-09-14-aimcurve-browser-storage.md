# aimcurve Browser Storage and App Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine from Plan A into the product: an IndexedDB-backed index over a folder the user picks, with the existing dashboard on top, and no Python anywhere.

**Architecture:** `web/src/db/` implements the `Store` interface Plan A defined, so the payload builder is reused untouched and Plan B writes no comparison logic. `web/src/source/` is the source boundary — `list`, `read`, and an optional `subscribe` that stays unimplemented here. `app.js` moves over near-verbatim with its `api()` seam pointed at `core/api.ts` instead of `fetch`.

**Tech Stack:** Astro 5 static output, TypeScript strict, Vitest, `fake-indexeddb` for the two indexer cases a real install cannot produce on demand. Browser APIs: IndexedDB, Web Locks, `navigator.storage.persist()`, `webkitdirectory`, `showDirectoryPicker`.

**Spec:** `docs/superpowers/specs/2026-09-14-aimcurve-browser-implementation-decisions.md` and `docs/superpowers/specs/2026-09-13-aimcurve-browser-design.md`.

**Depends on:** Plan A, complete and passing `npm run oracle`.

---

## Global Constraints

- **Nothing in `web/src/core/` changes.** If a task here needs to edit a core module, the `Store` boundary was drawn wrong — stop and say so rather than widening it. The one exception is the `Store` interface itself gaining `async` variants, which Task 3 handles explicitly and once.
- **IndexedDB is a cache, not a record.** The files on disk are the source of truth. A schema change is "bump the version, delete every store, re-bootstrap" — never a migration. Nothing lives only in the database.
- **Never write to the KovaaK's install.** Every source is read-only. The picker is opened with `mode: 'read'`.
- **Nothing leaves the machine.** No network request of any kind after the page loads. Chrome's directory dialog says *"Upload N files to this site?"*; the UI must contradict that in words **before** the dialog opens, because it is the first thing a new user reads.
- **A missing `.perf` is normal, not an error.** Roughly one run in seven has none.
- **Never `await` a non-IndexedDB promise while a transaction is open.** A transaction commits as soon as control returns to the event loop with no request pending, so an `await` on a dynamic import, a `File.text()`, a timer, or a second transaction's result silently deactivates the one you are holding — and the next `put` throws `TransactionInactiveError`, or worse, the reads before it came from a transaction that is now gone. Read everything a write needs *before* opening the write transaction.

  **Awaiting a request belonging to the open transaction is safe**, and the spec is explicit about it: the transaction stays active while one of its own requests is pending, which is what keeps `await req(store.get(id))` from committing underneath you. So a sequential loop over a transaction's own requests is *correct* — it is merely slow, because it costs one event-loop turn per row instead of one for the batch. Prefer issuing every request **synchronously** and awaiting them together, for the round trips rather than for safety:

  ```ts
  const tx = db.transaction(['curves', 'kills']);
  const curves = rows.map((r) => req(tx.objectStore('curves').get(r.id)));
  const kills = rows.map((r) => req(tx.objectStore('kills').get(r.id)));
  const [gotCurves, gotKills] = await Promise.all([
    Promise.all(curves), Promise.all(kills)]);
  ```

  The shape that genuinely fails, and fails intermittently, is `await` on anything the transaction does not own — `await file.text()` or `await import(...)` mid-transaction, not `await req(store.get(id))`.
- **Eviction is survivable.** Losing the database costs a re-pick and one bootstrap. Treat a `persist()` refusal as normal rather than as a failure.
- **Verification here is the integration pass**, on a machine with KovaaK's installed. Automated tests cover only the two indexer cases named in Task 5. Do not write tests that stub the browser into agreeing with you.

## What cannot be checked on the development machine

This machine has no KovaaK's install, no stats files, and no game. Everything below is therefore **integration-tested by the user**, and the plan says so rather than pretending otherwise:

- a real bootstrap's wall-clock cost and peak memory (the design measured 22.3 s and 49 MB on a synthetic 12k corpus and warns that is a lower bound)
- `showDirectoryPicker` against a real Steam library, and the `webkitdirectory` fallback
- `persist()` behaviour, eviction, and a returning visit after days
- multi-tab writer election in a real browser
- the full-corpus oracle diff, which is the browser design's stated exit criterion and the only thing that settles the `cfg_key` rounding question

## File Structure

```
web/src/db/schema.ts        store definitions, open, version-bump teardown, persist
web/src/db/packed.ts        Kill[] <-> one packed record per run
web/src/db/idbstore.ts      the Store interface, backed by IndexedDB
web/src/db/indexer.ts       index N basenames into an existing database
web/src/db/writer.ts        Web Locks writer election
web/src/source/types.ts     the RunSource interface
web/src/source/upload.ts    a FileList from <input webkitdirectory>
web/src/source/picker.ts    a FileSystemDirectoryHandle
web/src/source/pool.ts      bounded-concurrency reads
web/src/ui/app.js           moved from aimcurve/web/, api() repointed
web/src/ui/style.css        moved
web/public/vendor/          moved -- public/, not src/: uPlot's IIFE build only
                            sets its global as a classic top-level <script>
web/src/pages/index.astro   the shell
web/src/boot.ts             picks a source, elects a writer, indexes, renders
web/test/packed.test.ts
web/test/indexer.test.ts

DELETED at the end: aimcurve/server.py, aimcurve/watch.py, aimcurve/web/,
                    tests/test_server.py, tests/test_watch.py,
                    scripts/drive-client.mjs
```

## Review checkpoints

Stop for review after **Task 5**, **Task 7** and **Task 10**.

**Task order is a dependency order, not a preference.** The source boundary is Task 4 because Task 5's indexer imports `source/types.ts` and `source/pool.ts`; writing the indexer first leaves its test failing on a missing import rather than on the module it is meant to be driving out.

---

### Task 1: The database

**Files:**
- Create: `web/src/db/schema.ts`
- Install: `npm i -D fake-indexeddb`

**Interfaces:**
- Produces:
  - `SCHEMA_VERSION`, `DB_NAME`
  - `openDatabase(factory?: IDBFactory): Promise<IDBDatabase>`
  - `requestPersistence(): Promise<boolean>`
  - `req<T>(request: IDBRequest<T>): Promise<T>` and `done(tx: IDBTransaction): Promise<void>` — the two promise wrappers everything else uses
  - the stored record types

The layout is fixed by the browser design's measurements and should not be revisited casually:

- **Kills are packed one record per run, never one per kill.** 298,653 individual records took 28,354 ms to write; the same data as 8,875 packed records took 756 ms — 37× — and reads faster too, 4.7 ms against 16.2 ms.
- **`best_before` and `played_before` are materialised** on the run record, in both filter variants, turning the rail's correlated subqueries into a cursor walk: 4.2 ms against 296 ms.
- **`scenarios` carries the full shape record**, not just the list-page aggregate. A schema without `shape`, `windowed`, `bots` and `pool` silently reverts the 2026-09-12 design, because the payload builder branches entirely on them.

- [ ] **Step 1: Write `web/src/db/schema.ts`**

```ts
/** The IndexedDB layout.
 *
 * This database is a disposable cache over files the game owns. Nothing lives
 * only here, which is what makes "bump the version, delete everything and
 * re-bootstrap" a legitimate migration -- the same strategy the Python's
 * SQLite index uses, for the same reason.
 */

import type { RunMarks, Scenario, SeriesName, Run } from '../core/types';

export const DB_NAME = 'aimcurve';
export const SCHEMA_VERSION = 1;

/** How many times a file is re-parsed before it is given up on.
 *
 * A parse that failed because the file was still being written is a retry, not
 * a failure. Without a ceiling a genuinely corrupt file is either re-parsed
 * forever or dropped silently.
 */
export const MAX_TRIES = 5;

/** A run as stored: the summary, plus the two derived things the rail reads
 *  without touching another store. */
export interface StoredRun extends Run {
  /** null when the run has no per-second data. The rail's marker. */
  buckets: number | null;
  marks: RunMarks;
}

/** Seven ArrayBuffers, in the order `SERIES` declares. IndexedDB stores them
 *  natively, so there is no encoding step on either side. */
export interface StoredCurve {
  run_id: string;
  buckets: number;
  duration_s: number;
  series: Record<SeriesName, ArrayBuffer>;
}

export interface StoredFailure {
  basename: string;
  tries: number;
  last_error: string;
  last_try: string;
}

export interface StoredMeta {
  key: string;
  value: unknown;
}

/** Promise wrapper for a single request. */
export function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Promise wrapper for a whole transaction. Await this, not the last request:
 *  a write is not durable until the transaction commits. */
export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

function create(db: IDBDatabase): void {
  const runs = db.createObjectStore('runs', { keyPath: 'id' });
  // The rail reads newest-first across every scenario, so it needs its own
  // index: the composite ones below cannot serve that order.
  runs.createIndex('started_at', 'started_at');
  runs.createIndex('scen_time', ['scenario', 'started_at']);
  // The PB run, for its curve.
  runs.createIndex('scen_score', ['scenario', 'score']);

  db.createObjectStore('curves', { keyPath: 'run_id' });
  db.createObjectStore('kills', { keyPath: 'run_id' });
  db.createObjectStore('scenarios', { keyPath: 'name' });
  db.createObjectStore('failed', { keyPath: 'basename' });
  db.createObjectStore('meta', { keyPath: 'key' });
}

export function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Every store is dropped, not migrated. Every store has to be listed:
      // leaving one out means it survives the teardown and its createObjectStore
      // then fails because it still exists.
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
      create(db);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Without this, a tab left open on an older schema blocks every new tab
      // for ever: the newcomer's open() sits in onblocked until this connection
      // goes away, and nothing makes it go away. Closing on demand costs this
      // tab nothing -- the database is a cache, and a reload rebuilds it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error(
        'another tab is using an older version of aimcurve. Close aimcurve’s ' +
        'other tabs and reload this one.'));
  });
}

/** Ask the browser not to evict us.
 *
 * A miss is normal, not an error: browsers may clear best-effort origin storage
 * and Safari does so after about seven days without interaction. The cost is a
 * re-pick and one bootstrap, not lost data.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Meta keys. `indexed` is the set of basenames already in the database; `read_at`
 *  is when the folder was last enumerated, which is the only thing the app knows
 *  about how stale it is. */
export const META_INDEXED = 'indexed';
export const META_READ_AT = 'read_at';
export const META_PERSISTED = 'persisted';
/** The directory handle the index was built from, so a reload does not downgrade
 *  a picker user to re-enumerating their whole install. Handles survive
 *  structured clone, which is why they can live here at all. Task 9 uses both. */
export const META_HANDLE = 'handle';
/** The name of that folder, so picking a *different* install is noticed rather
 *  than silently merged into the same rail for ever. */
export const META_ROOT_NAME = 'root_name';
```

- [ ] **Step 2: Install the test dependency**

Run: `cd web && npm i -D fake-indexeddb`

- [ ] **Step 3: Type-check**

Run: `cd web && npx astro check`
Expected: `0 errors`.

- [ ] **Step 4: Commit**

```bash
git add web/src/db/schema.ts web/package.json web/package-lock.json
git commit -m "Define the IndexedDB layout

Kills packed one record per run rather than one per kill -- 37x on writes at
12k runs and faster to read -- and the rail's marks materialised on the run
record, which is 4.2 ms against 296 ms. Both numbers are from the browser
design's measurements, not guesses.

A version bump deletes every store and re-bootstraps. Nothing lives only here."
```

---

### Task 2: Packing kills

**Files:**
- Create: `web/src/db/packed.ts`
- Test: `web/test/packed.test.ts`

**Interfaces:**
- Consumes: `core/types.ts`.
- Produces: `pack(runId: string, kills: readonly Kill[]): PackedKills` and `unpack(packed: PackedKills): Kill[]`.

Numeric fields are `Float64Array` with `NaN` standing for null. Float64 rather than Float32 because the Python stores these as SQLite `REAL` and the oracle diff compares them without a tolerance where it can; the extra 8 MB at a 12k-run corpus buys exactness in the one place a rounding difference would be invisible. `idx` is not stored — it is the position plus one, which is what `parseKills` assigns.

- [ ] **Step 1: Write the failing test**

Create `web/test/packed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pack, unpack } from '../src/db/packed';
import { parseKills } from '../src/core/statscsv';
import { readStats } from './fixtures';

const AIR = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const EASTER = 'Happy Easter! - Challenge - 2026.04.06-18.13.05';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';

describe('pack / unpack', () => {
  it('round-trips a run\'s kills exactly', () => {
    const kills = parseKills(readStats(AIR));
    expect(unpack(pack(AIR, kills))).toEqual(kills);
  });

  it('round-trips every fixture', () => {
    for (const id of [AIR, EASTER, TRACKING]) {
      const kills = parseKills(readStats(id));
      expect(unpack(pack(id, kills))).toEqual(kills);
    }
  });

  it('is one record, not one per kill', () => {
    const packed = pack(AIR, parseKills(readStats(AIR)));
    expect(packed.n).toBe(5);
    expect(packed.ttk).toBeInstanceOf(Float64Array);
    expect(packed.ttk).toHaveLength(5);
    expect(packed.bots).toEqual([
      'AIR1_Short_close', 'AIR1_Short_far', 'AIR2_Long3D_mid',
      'AIR2_Short_close', 'AIR2_Mid_UFO',
    ]);
  });

  it('handles a run with no kills at all', () => {
    // 1090 of 2360 real runs. The normal case, not an edge case.
    const packed = pack(TRACKING, []);
    expect(packed.n).toBe(0);
    expect(unpack(packed)).toEqual([]);
  });

  it('preserves nulls through NaN', () => {
    const kills = [{
      idx: 1, t: 1.5, bot: 'b', weapon: 'w', ttk: null,
      shots: null, hits: 3, overshots: null, dmg_done: null, dmg_possible: 0,
    }];
    expect(unpack(pack('x', kills))).toEqual(kills);
  });

  it('renumbers idx from position, as parseKills does', () => {
    // Happy Easter! writes 0 in the file's own Kill # column on every row.
    const kills = parseKills(readStats(EASTER));
    expect(unpack(pack(EASTER, kills)).map((k) => k.idx)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/packed.test.ts`
Expected: `Failed to resolve import "../src/db/packed"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/db/packed.ts`:

```ts
/** One record per run, not one per kill.
 *
 * 298,653 individual kill records took 28,354 ms to write on the design's 12k
 * corpus; the same data packed into 8,875 records took 756 ms, and reads
 * faster too. Per-kill rows look reasonable at 2,000 runs and fall off a cliff
 * at 12,000.
 *
 * Numeric fields are Float64Array with NaN standing for null. Float64 rather
 * than Float32 because the Python stores these as SQLite REAL, and the one
 * place a rounding difference would be invisible is exactly here.
 */

import type { Kill } from '../core/types';

export interface PackedKills {
  run_id: string;
  n: number;
  t: Float64Array;
  ttk: Float64Array;
  shots: Float64Array;
  hits: Float64Array;
  overshots: Float64Array;
  dmg_done: Float64Array;
  dmg_possible: Float64Array;
  bots: string[];
  weapons: string[];
}

const NUMERIC = [
  't', 'ttk', 'shots', 'hits', 'overshots', 'dmg_done', 'dmg_possible',
] as const;

const toCell = (v: number | null): number => (v === null ? NaN : v);
const fromCell = (v: number): number | null => (Number.isNaN(v) ? null : v);

export function pack(runId: string, kills: readonly Kill[]): PackedKills {
  const n = kills.length;
  const packed = {
    run_id: runId,
    n,
    bots: kills.map((k) => k.bot),
    weapons: kills.map((k) => k.weapon),
  } as PackedKills;
  for (const field of NUMERIC) {
    const column = new Float64Array(n);
    for (let i = 0; i < n; i++) column[i] = toCell(kills[i][field]);
    packed[field] = column;
  }
  return packed;
}

export function unpack(packed: PackedKills): Kill[] {
  const kills: Kill[] = [];
  for (let i = 0; i < packed.n; i++) {
    kills.push({
      // idx is the position plus one, which is what parseKills assigns: the
      // file's own Kill # column is 0 on every row in at least one scenario.
      idx: i + 1,
      t: packed.t[i],
      bot: packed.bots[i],
      weapon: packed.weapons[i],
      ttk: fromCell(packed.ttk[i]),
      shots: fromCell(packed.shots[i]),
      hits: fromCell(packed.hits[i]),
      overshots: fromCell(packed.overshots[i]),
      dmg_done: fromCell(packed.dmg_done[i]),
      dmg_possible: fromCell(packed.dmg_possible[i]),
    });
  }
  return kills;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run test/packed.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/db/packed.ts web/test/packed.test.ts
git commit -m "Pack a run's kills into one record

One record per kill is 37x slower to write at 12k runs and slower to read. NaN
stands for null so the round trip is lossless, and idx comes from position
rather than from the file's own Kill # column, which is 0 on every row in at
least one real scenario."
```

---

### Task 3: The IndexedDB Store

**Files:**
- Create: `web/src/db/idbstore.ts`
- Modify: `web/src/core/store.ts` (the one sanctioned change: the interface becomes async)
- Modify: `web/src/core/memstore.ts`, `web/src/core/baselines.ts`, `web/src/core/payload.ts`, `web/src/core/api.ts` (await the Store)
- Modify: the Plan A tests that call these

**This is the one place Plan B is allowed to touch `core/`, and it is a mechanical change**: every `Store` method returns a `Promise`, every caller awaits. IndexedDB has no synchronous read, so the alternative is loading the whole database into memory on every page — which is what the packed-kills and materialised-marks measurements exist to avoid.

Do this as one commit, with no behaviour change: the Plan A test suite and `npm run oracle` must both still pass afterwards. If the oracle diff breaks, something other than `async` changed.

- [ ] **Step 1: Make the interface async**

In `web/src/core/store.ts`, wrap every return type:

```ts
export interface Store {
  getRun(id: string): Promise<Run | undefined>;
  getScenario(name: string): Promise<Scenario | undefined>;
  getCurve(id: string): Promise<Curve | undefined>;
  getKills(id: string): Promise<Kill[]>;
  candidates(id: string, opts: CandidateOpts): Promise<Run[]>;
  page(limit: number, opts: PageOpts): Promise<RailRow[]>;
  bestBySlot(ids: readonly string[], metric: SlotMetric): Promise<Map<number, number>>;
  scenarioList(): Promise<ScenarioListRow[]>;
  day(day: string): Promise<SessionRow[]>;
  days(): Promise<string[]>;
  counts(): Promise<Counts>;
}
```

- [ ] **Step 2: Propagate**

`memstore.ts` methods become `async` (their bodies are unchanged; an `async` function returning a value returns a resolved promise). `baselines`, `buildRunPayload`, `fillTimed`, `fillRace`, `raceSplits`, `botWindows`, `windowSummary`, `peerIds`, and every `api.ts` function become `async` and `await` each Store call.

Two places need care because they are inside callbacks:

- `fillRace`'s band loop uses `base.recent.curve.forEach` with an `await` inside. Convert it to a `for` loop over indices.
- `raceSplits` and `botWindows` call `store.getKills` in a `map`. Hoist the awaits above the `map`.
- `getSession` indexes the result of `store.days()` directly (`days[days.length - 1]`). A missed `await` there does not throw — it reads `.length` off a promise and answers `{ day: undefined, runs: [] }`, an empty session panel with no error anywhere. `astro check` catches it, which is why Step 4 runs it.

- [ ] **Step 3: Update the tests**

Every Plan A test that calls a Store method or an api function awaits it. The `const store = buildStore(...)` lines stay synchronous — `buildStore` itself is not async.

- [ ] **Step 4: Verify nothing else changed**

Run: `cd web && npm test && npx astro check`
Expected: all passed, `0 errors`.

Run: `nix shell nixpkgs#python3 --command bash -c 'cd web && npm run oracle'`
Expected: 9 passed. **If the oracle diff now fails, revert and redo the change — `async` cannot alter a value.**

- [ ] **Step 5: Commit the async conversion on its own**

```bash
git add web/src/core web/test
git commit -m "Make the Store interface async

IndexedDB has no synchronous read, and the alternative -- loading the whole
database into memory on every page -- is what the packed-kills and materialised
-marks layouts exist to avoid. Mechanical: the oracle diff still passes, which
is the check that nothing but the await changed."
```

- [ ] **Step 6: Write `web/src/db/idbstore.ts`**

```ts
/** The Store, backed by IndexedDB.
 *
 * Every query here was written and timed against this layout at 12k runs by
 * the browser design; the comments carry the numbers so a future rewrite has
 * to beat something rather than guess.
 */

import { DURATION_TOLERANCE, pySum } from '../core/compare';
import { RACE } from '../core/shapes';
import type {
  CandidateOpts, Counts, PageOpts, ScenarioListRow, SessionRow, SlotMetric, Store,
} from '../core/store';
import { SERIES } from '../core/types';
import type { Curve, Kill, RailRow, Run, Scenario, Series } from '../core/types';
import { unpack, type PackedKills } from './packed';
import { done, req, type StoredCurve, type StoredRun } from './schema';

const RECENT_FORM_N = 10;

function compareRuns(a: { started_at: string; id: string },
                     b: { started_at: string; id: string }): number {
  if (a.started_at !== b.started_at) return a.started_at < b.started_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toRun(stored: StoredRun): Run {
  const { buckets, marks, ...run } = stored;
  return run;
}

function toCurve(stored: StoredCurve): Curve {
  const series = Object.fromEntries(
    SERIES.map((name) => [name, new Float32Array(stored.series[name])]),
  ) as Series;
  return { buckets: stored.buckets, duration_s: stored.duration_s, series };
}

export function createStore(db: IDBDatabase): Store {
  const get = <T>(store: string, key: IDBValidKey): Promise<T | undefined> =>
    req(db.transaction(store).objectStore(store).get(key) as IDBRequest<T | undefined>);

  const stored = (id: string) => get<StoredRun>('runs', id);

  /** Every run of one scenario, oldest first. Served directly by scen_time:
   *  2.0 ms at 12k runs. */
  async function ofScenario(scenario: string): Promise<StoredRun[]> {
    const index = db.transaction('runs').objectStore('runs').index('scen_time');
    const rows = await req<StoredRun[]>(
      index.getAll(IDBKeyRange.bound([scenario, ''], [scenario, '￿'])));
    return rows.sort(compareRuns);
  }

  return {
    async getRun(id) {
      const row = await stored(id);
      return row ? toRun(row) : undefined;
    },

    getScenario: (name) => get<Scenario>('scenarios', name),

    async getCurve(id) {
      const row = await get<StoredCurve>('curves', id);
      return row ? toCurve(row) : undefined;
    },

    async getKills(id) {
      const row = await get<PackedKills>('kills', id);
      return row ? unpack(row) : [];
    },

    async candidates(id: string, opts: CandidateOpts): Promise<Run[]> {
      const focus = await stored(id);
      if (!focus) throw new Error(`no such run: ${id}`);
      let rows = (await ofScenario(focus.scenario)).filter((r) => r.id !== id);
      if (opts.sameCfg && focus.cfg_key !== null) {
        rows = rows.filter((r) => r.cfg_key === focus.cfg_key);
      }
      // Duration is the score on a race scenario, so filtering baselines by it
      // throws away the comparison.
      const target = focus.duration_s;
      if (target && opts.shape !== RACE) {
        rows = rows.filter((r) =>
          r.duration_s === null
          || Math.abs(r.duration_s - target) <= target * opts.durationTol);
      }
      return rows.map(toRun);
    },

    /** The rail. With the marks materialised this is a cursor walk on
     *  started_at descending -- 4.2 ms at 12k runs, and 3.6 ms at 10,000 rows
     *  deep, so paging stays flat. Computing the marks per row instead costs
     *  296 ms. */
    async page(limit: number, opts: PageOpts): Promise<RailRow[]> {
      const cursorRun = opts.before != null ? await stored(opts.before) : undefined;
      // An unknown cursor pages to nothing, not to everything. The SQL's
      // subquery yields NULL, `(started_at, id) < NULL` is NULL, and no row
      // survives; dropping the predicate instead wraps an infinite scroll back
      // to the newest rows and repeats them for ever. See memstore.ts:129-140,
      // which carries the same comment because this was already fixed once.
      if (opts.before != null && !cursorRun) return [];
      const index = db.transaction('runs').objectStore('runs').index('started_at');
      const range = cursorRun
        ? IDBKeyRange.upperBound(cursorRun.started_at)
        : null;

      const out: RailRow[] = [];
      await new Promise<void>((resolve, reject) => {
        const request = index.openCursor(range, 'prev');
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || out.length >= limit) return resolve();
          const row = cursor.value as StoredRun;
          // The cursor's bound is on started_at alone, which has second
          // resolution and no uniqueness constraint. The pair comparison is
          // what stops a run whose timestamp straddles a page boundary being
          // repeated or skipped.
          const past = !cursorRun || compareRuns(row, cursorRun) < 0;
          const wanted = !opts.scenario || row.scenario === opts.scenario;
          if (past && wanted) {
            const set = opts.sameCfg ? row.marks.cfg : row.marks.any;
            out.push({
              id: row.id, scenario: row.scenario, started_at: row.started_at,
              score: row.score, accuracy: row.accuracy, spm: row.spm,
              cfg_key: row.cfg_key, buckets: row.buckets,
              shape: null, // filled below
              best_before: set.best_before, played_before: set.played_before,
            });
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });

      // One pass for the shapes rather than a lookup per row.
      const names = [...new Set(out.map((r) => r.scenario))];
      const shapes = new Map<string, Scenario>();
      for (const name of names) {
        const scenario = await get<Scenario>('scenarios', name);
        if (scenario) shapes.set(name, scenario);
      }
      for (const row of out) row.shape = shapes.get(row.scenario)?.shape ?? null;
      return out;
    },

    /** GROUP BY idx becomes a get per peer and a loop over typed arrays:
     *  4.7 ms over 30 peers. */
    async bestBySlot(ids: readonly string[], metric: SlotMetric) {
      const store = db.transaction('kills').objectStore('kills');
      const best = new Map<number, number>();
      for (const id of ids) {
        const packed = await req<PackedKills | undefined>(store.get(id));
        if (!packed) continue;
        for (let i = 0; i < packed.n; i++) {
          let value: number;
          if (metric === 'ttk') {
            value = packed.ttk[i];
          } else {
            // No damage offered means no share, not a share of zero.
            if (!packed.dmg_possible[i]) continue;
            value = packed.dmg_done[i] / packed.dmg_possible[i];
          }
          if (Number.isNaN(value)) continue;
          const slot = i + 1;
          const current = best.get(slot);
          const better = current === undefined
            || (metric === 'ttk' ? value < current : value > current);
          if (better) best.set(slot, value);
        }
      }
      return best;
    },

    /** The maintained aggregate, read whole. The full scan this replaces is
     *  247 ms at 12k runs and is only the rebuild path. */
    async scenarioList(): Promise<ScenarioListRow[]> {
      const scenarios = await req<Scenario[]>(
        db.transaction('scenarios').objectStore('scenarios').getAll());
      const out: ScenarioListRow[] = [];
      for (const scenario of scenarios) {
        const rows = await ofScenario(scenario.name);
        if (!rows.length) continue;
        const scored = rows.filter((r) => r.score !== null);
        const byScore = [...scored].sort((a, b) => (b.score as number) - (a.score as number));
        const recent = rows.slice(-RECENT_FORM_N);
        // pySum, not reduce: SQLite's AVG has summed with Neumaier
        // compensation since 3.42, and memstore.ts:96 matches it. A plain
        // left-to-right sum is invisible on the fixtures -- no scenario has
        // enough runs -- and diverges against a real install.
        const mean = (values: number[]) =>
          values.length ? pySum(values) / values.length : null;
        out.push({
          scenario: scenario.name,
          runs: rows.length,
          pb: byScore.length ? (byScore[0].score as number) : null,
          last_played: rows[rows.length - 1].started_at,
          shape: scenario.shape,
          pb_elapsed: byScore.length ? byScore[0].elapsed_s : null,
          recent_elapsed: mean(
            recent.map((r) => r.elapsed_s).filter((v): v is number => v !== null)),
          recent_form: mean(
            recent.map((r) => r.score).filter((v): v is number => v !== null)),
        });
      }
      // 0 on equality, not -1: an inconsistent comparator sorts unpredictably,
      // and the oracle compares this list positionally. memstore.ts:195-196
      // spells the equal case out for the same reason.
      return out.sort((a, b) =>
        a.last_played === b.last_played ? 0 : a.last_played < b.last_played ? 1 : -1);
    },

    /** substr(started_at,1,10) = ? becomes a bounded range, since the field is
     *  a sortable ISO string. 1.0 ms. */
    async day(day: string): Promise<SessionRow[]> {
      const index = db.transaction('runs').objectStore('runs').index('started_at');
      const rows = await req<StoredRun[]>(index.getAll(
        IDBKeyRange.bound(`${day}T00:00:00`, `${day}T23:59:59`)));
      return rows.sort(compareRuns).map((r) => ({
        id: r.id, scenario: r.scenario, started_at: r.started_at,
        score: r.score, accuracy: r.accuracy, spm: r.spm,
      }));
    },

    async days(): Promise<string[]> {
      // A key cursor, not getAllKeys(): on an *index*, getAllKeys() returns the
      // PRIMARY keys, which here are the run basenames -- so slice(0, 10) would
      // yield 'Air Pure M' rather than '2026-04-06'. It cascades, because
      // api.getSession takes days[days.length - 1] and would then ask for a day
      // that matches no row at all. cursor.key is the index key.
      const index = db.transaction('runs').objectStore('runs').index('started_at');
      const days = new Set<string>();
      await new Promise<void>((resolve, reject) => {
        const request = index.openKeyCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve();
          days.add(String(cursor.key).slice(0, 10));
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
      return [...days].sort();
    },

    async counts(): Promise<Counts> {
      const count = (name: string) =>
        req(db.transaction(name).objectStore(name).count());
      return {
        runs: await count('runs'),
        curves: await count('curves'),
        failed: await count('failed'),
        scenarios: await count('scenarios'),
      };
    },
  };
}
```

- [ ] **Step 7: Type-check**

Run: `cd web && npx astro check`
Expected: `0 errors`.

- [ ] **Step 8: Commit**

```bash
git add web/src/db/idbstore.ts
git commit -m "Implement the Store over IndexedDB

Every query here was timed against this layout at 12k runs; the comments carry
the numbers. The rail is a cursor walk because the marks are materialised, and
the pair comparison inside it is what stops a run whose timestamp straddles a
page boundary being repeated or skipped -- the index bound is on started_at
alone, which is not a total order."
```

---

### Task 4: The source boundary

**Files:**
- Create: `web/src/source/types.ts`
- Create: `web/src/source/pool.ts`
- Create: `web/src/source/upload.ts`
- Create: `web/src/source/picker.ts`

**The indexer must never be able to tell which source it has.** That is the whole point of the boundary: step two adds `subscribe` to the picker source and changes nothing above it.

A `FileList` from `<input webkitdirectory>` satisfies `list` and `read`. A `FileSystemDirectoryHandle` satisfies all three, but `subscribe` is left unimplemented here — this plan ships no live updates.

- [ ] **Step 1: Write `web/src/source/types.ts`**

```ts
/** Where runs come from.
 *
 * Two implementations today and a third shape in mind. The indexer must never
 * be able to tell which it has: step two implements `subscribe` on the picker
 * source and changes nothing above this line.
 */

export interface RunFiles {
  /** The Stats.csv text, absent if the run has no CSV (an orphan `.perf`). */
  stats?: string;
  /** The Performance.perf bytes, absent for the ~1 run in 7 that has none. */
  perf?: Uint8Array;
}

export interface RunSource {
  readonly kind: 'upload' | 'picker';
  /** When the folder was enumerated, in epoch milliseconds. The app knows this
   *  and nothing about what has happened since, which is exactly what the
   *  staleness notice reports. */
  readonly pickedAt: number;
  /** The run basenames this source can offer -- a stats basename with
   *  " Stats.csv" removed. */
  list(): Promise<string[]>;
  read(id: string): Promise<RunFiles>;
  /** Absent in this plan. Step two implements it with a FileSystemObserver. */
  subscribe?(fn: (ids: string[]) => void): () => void;
}

export const STATS_SUFFIX = ' Stats.csv';
export const PERF_SUFFIX = ' Performance.perf';

export function statsIdOf(filename: string): string | null {
  return filename.endsWith(STATS_SUFFIX)
    ? filename.slice(0, -STATS_SUFFIX.length) : null;
}

export function perfIdOf(filename: string): string | null {
  return filename.endsWith(PERF_SUFFIX)
    ? filename.slice(0, -PERF_SUFFIX.length) : null;
}
```

- [ ] **Step 2: Write `web/src/source/pool.ts`**

```ts
/** Bounded-concurrency reads.
 *
 * Reading is 15 s of the browser design's 22 s bootstrap at 12k runs, and it is
 * the only phase worth parallelising: 0.925 ms/file serial against 0.175 ms at
 * 8 parallel on the machine that was measured.
 *
 * The pool size is deliberately not a constant tuned on one device. High
 * concurrency does not help on a spinning disk or a network-redirected profile,
 * and the measured curve is flat from 8 to 128 -- so the value is chosen from
 * the low end of that flat region, where the gain is already banked and the
 * memory held in flight is smallest. It is not the midpoint of the range, and
 * it is not the fastest observed point.
 */

export const DEFAULT_CONCURRENCY = 12;

/** Run `work` over every item, at most `concurrency` at a time.
 *
 * `work` is called in input order but *completes* in whatever order the reads
 * finish, so a caller that pushes into an array gets completion order, not
 * input order. Sort afterwards if the order matters.
 *
 * The first rejection stops the pool and propagates: the remaining items are
 * left untouched rather than being read into a caller that has already
 * unwound.
 */
export async function readAll<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<void> {
  const width = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      // Without this the other width-1 workers keep draining the list after one
      // of them has thrown -- calling `work` on every remaining item while the
      // caller has already unwound and possibly torn its database down. How
      // much still runs depends on the width, so one unreadable file would give
      // a different partial index at width 1 than at width 2.
      if (failed) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        await work(items[i]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  await Promise.all(workers);
}
```

- [ ] **Step 3: Write `web/src/source/upload.ts`**

```ts
/** A one-shot directory snapshot from <input type="file" webkitdirectory>.
 *
 * The entry point for anyone whose install is where Chrome refuses to let a
 * page look: unlike the File System Access API this is not subject to the
 * sensitive-path blocklist, so it reads a default
 * `C:\Program Files (x86)\Steam\...` install directly, and it works in Firefox
 * and Safari, which have no File System Access API at all.
 *
 * What it cannot do is look again without another user gesture. That is why
 * there is no `subscribe` here and why the UI has to report the data's age.
 */

import { perfIdOf, statsIdOf, type RunFiles, type RunSource } from './types';

export function uploadSource(files: FileList | readonly File[]): RunSource {
  const stats = new Map<string, File>();
  const perfs = new Map<string, File>();
  let sawStatsDir = false;

  for (const file of Array.from(files)) {
    // webkitRelativePath is the whole path under the chosen folder, e.g.
    // "FPSAimTrainer/stats/Foo - Challenge - 2026.09.03-19.08.37 Stats.csv",
    // and it is the parent directory that has to be checked -- not just the
    // filename. Matching on the name alone indexes every "* Stats.csv"
    // anywhere in the tree: a backup folder, or a second install, with the last
    // File silently winning a name collision. The picker source reads strictly
    // stats/ and performances/, and the indexer must never be able to tell the
    // two sources apart.
    const parts = file.webkitRelativePath.split('/');
    if (parts.length < 2) continue;  // no directory information: not ours
    const dir = parts[parts.length - 2];
    const name = parts[parts.length - 1];
    if (dir === 'stats') {
      sawStatsDir = true;
      const statsId = statsIdOf(name);
      if (statsId !== null) stats.set(statsId, file);
    } else if (dir === 'performances') {
      const perfId = perfIdOf(name);
      if (perfId !== null) perfs.set(perfId, file);
    }
  }

  // The same error the picker source raises for the same mistake. Returning an
  // empty source instead renders as "No runs yet", which reads as "you have not
  // played" rather than "you picked the wrong folder".
  if (!sawStatsDir) throw new Error('that folder has no stats/ directory');

  const pickedAt = Date.now();

  return {
    kind: 'upload',
    pickedAt,
    async list() {
      // Stats files only: an orphan `.perf` with no CSV is not a run. Eight
      // were observed in a real install.
      return [...stats.keys()].sort();
    },
    async read(id: string): Promise<RunFiles> {
      const out: RunFiles = {};
      const csv = stats.get(id);
      if (csv) out.stats = await csv.text();
      const perf = perfs.get(id);
      if (perf) out.perf = new Uint8Array(await perf.arrayBuffer());
      return out;
    },
  };
}
```

- [ ] **Step 4: Write `web/src/source/picker.ts`**

```ts
/** A directory the user granted through showDirectoryPicker().
 *
 * Preferred where it works: it is the same code past this boundary, it reads
 * without copying every file into the page, and the handle can be stored so the
 * folder is chosen once rather than per visit. It leaves the door open for step
 * two, which adds `subscribe` here and nowhere else.
 *
 * It does not work on a default Windows install -- Chrome refuses any directory
 * under Program Files, by every route -- so it must never be required. On Linux
 * the default Steam path is not on Chromium's blocklist, so it works directly.
 */

import { perfIdOf, statsIdOf, type RunFiles, type RunSource } from './types';

export function supportsPicker(): boolean {
  return typeof (globalThis as any).showDirectoryPicker === 'function';
}

/** Ask for the KovaaK's folder. Returns null if the user cancelled or the
 *  browser refused the directory. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsPicker()) return null;
  try {
    return await (globalThis as any).showDirectoryPicker({
      id: 'aimcurve-kovaaks',
      // Read-only, always. aimcurve never writes to the game's folder.
      mode: 'read',
    });
  } catch {
    return null;
  }
}

async function subdirectory(
  root: FileSystemDirectoryHandle, name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(name);
  } catch {
    // performances/ is genuinely optional: a fresh install has not created it,
    // and 318 runs in a real install have no `.perf` at all.
    return null;
  }
}

export async function pickerSource(
  root: FileSystemDirectoryHandle,
): Promise<RunSource> {
  const statsDir = await subdirectory(root, 'stats');
  if (!statsDir) throw new Error('that folder has no stats/ directory');
  const perfDir = await subdirectory(root, 'performances');
  const pickedAt = Date.now();

  return {
    kind: 'picker',
    pickedAt,
    async list() {
      const ids: string[] = [];
      // .keys(), never .entries(): a names-only enumeration is the cheap one,
      // and at 12k runs even that costs ~2.2 s per directory.
      for await (const name of (statsDir as any).keys()) {
        const id = statsIdOf(name);
        if (id !== null) ids.push(id);
      }
      return ids.sort();
    },
    async read(id: string): Promise<RunFiles> {
      const out: RunFiles = {};
      try {
        const handle = await statsDir.getFileHandle(`${id} Stats.csv`);
        out.stats = await (await handle.getFile()).text();
      } catch { /* the file went away between listing and reading */ }
      if (perfDir) {
        try {
          const handle = await perfDir.getFileHandle(`${id} Performance.perf`);
          out.perf = new Uint8Array(await (await handle.getFile()).arrayBuffer());
        } catch { /* no .perf, which is the normal case for ~1 run in 7 */ }
      }
      return out;
    },
    // No subscribe. This plan ships no live updates; step two adds it here.
  };
}
```

The `perfIdOf` import in `picker.ts` is unused — remove it before committing.

- [ ] **Step 5: Type-check**

Run: `cd web && npx astro check`
Expected: `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add web/src/source
git commit -m "Add the source boundary and its two implementations

The indexer must never be able to tell which source it has: step two implements
subscribe on the picker source and changes nothing above that line.

The upload control is the one that reaches a default Windows install -- it is
not subject to Chrome's sensitive-path blocklist and it works in Firefox and
Safari -- so the picker is preferred where it works and never required."
```

---

### Task 5: The incremental indexer

**Files:**
- Create: `web/src/db/indexer.ts`
- Test: `web/test/indexer.test.ts`

**Interfaces:**
- Consumes: `core/ingest.ts`, `core/scenario.ts`, `core/marks.ts`, `db/schema.ts`, `db/packed.ts`, `source/types.ts`.
- Produces:

```ts
export interface IndexProgress { phase: 'reading' | 'writing' | 'classifying'; done: number; total: number }
export interface IndexResult { runs: number; curves: number; failed: number; skipped: number }
export interface IndexOptions { force?: boolean; concurrency?: number }
export function indexInto(db, source, ids, onProgress?, options?: IndexOptions): Promise<IndexResult>;
export function pendingIds(db, source): Promise<string[]>;
```

**There is one indexing path, and a bootstrap is it over an empty database.** The browser design is explicit about this: the incremental path — *index these N new basenames into an existing database* — is exactly what an observer will call in step two. A bootstrap must not be a second implementation.

Four rules, and the last two are what the tests cover because a real install cannot produce them on demand:

1. **A file already indexed is skipped**, read from the `indexed` set in `meta` rather than by counting rows.
2. **A parse failure is recorded and retried, up to `MAX_TRIES`.** Half-written files are expected. Past the ceiling the file is left alone.
3. **Every scenario touched by the batch is reclassified**, over all of its runs — not just the new ones. A second run is exactly what promotes a curveless race scenario out of `timed`, and a scenario becomes `race` on its first `.perf`.
4. **Marks are recomputed for every scenario touched.** The browser design describes a forward pass from the earliest affected `started_at`; recomputing the whole scenario is simpler, always correct, and costs the same order — marks depend only on other runs of the same scenario. If a real corpus ever makes this slow, the forward pass is the optimisation, not a correctness fix.

- [ ] **Step 1: Write the failing test**

Create `web/test/indexer.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createStore } from '../src/db/idbstore';
import { indexInto, pendingIds } from '../src/db/indexer';
import { openDatabase } from '../src/db/schema';
import type { RunSource } from '../src/source/types';
import { readPerf, readStats, statsIds } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const SPECTRAL_A = 'Air Spectral Easy - Challenge - 2026.09.05-08.20.43';
const SPECTRAL_B = 'Air Spectral Easy - Challenge - 2026.09.11-18.37.39';

/** A source over a chosen subset of the fixtures. */
function fixtureSource(ids: string[]): RunSource {
  return {
    kind: 'upload',
    pickedAt: Date.now(),
    async list() { return ids; },
    async read(id: string) {
      return { stats: readStats(id), perf: readPerf(id) };
    },
  };
}

let db: IDBDatabase;

beforeEach(async () => {
  // A fresh factory per test: fake-indexeddb is global state otherwise.
  globalThis.indexedDB = new IDBFactory();
  db = await openDatabase(globalThis.indexedDB);
});

describe('indexInto', () => {
  it('indexes a batch and reports what it did', async () => {
    const ids = statsIds();
    const result = await indexInto(db, fixtureSource(ids), ids);
    expect(result).toEqual({ runs: 11, curves: 7, failed: 0, skipped: 0 });
    expect(await createStore(db).counts()).toEqual({
      runs: 11, curves: 7, failed: 0, scenarios: 8,
    });
  });

  it('skips what it has already indexed', async () => {
    const ids = statsIds();
    const source = fixtureSource(ids);
    await indexInto(db, source, ids);
    expect(await pendingIds(db, source)).toEqual([]);
    const again = await indexInto(db, source, ids);
    expect(again).toMatchObject({ runs: 0, skipped: 11 });
  });

  it('reports only what is new after a partial index', async () => {
    const source = fixtureSource(statsIds());
    await indexInto(db, source, [AIR_A]);
    const pending = await pendingIds(db, source);
    expect(pending).toHaveLength(10);
    expect(pending).not.toContain(AIR_A);
  });

  it('records a parse failure with a try count and retries it', async () => {
    const broken: RunSource = {
      ...fixtureSource([AIR_A]),
      async read() { return { stats: readStats(AIR_A), perf: new Uint8Array([0x0a, 0x40, 0x01]) }; },
    };
    const readFailure = () => new Promise<any>((resolve) => {
      const r = db.transaction('failed').objectStore('failed').get(AIR_A);
      r.onsuccess = () => resolve(r.result);
    });

    const first = await indexInto(db, broken, [AIR_A]);
    // The run is indexed from its CSV; only the curve failed.
    expect(first).toMatchObject({ runs: 1, curves: 0, failed: 1 });
    expect((await readFailure()).tries).toBe(1);
    expect((await readFailure()).last_error).toContain('truncated');

    // The retry half of the name, which needs a second pass to mean anything.
    // A file recorded as failed must NOT have been marked indexed, or it is
    // never re-read, `tries` can never exceed 1, and MAX_TRIES is unreachable.
    const second = await indexInto(db, broken, [AIR_A]);
    expect(second).toMatchObject({ runs: 1, curves: 0, failed: 1, skipped: 0 });
    expect((await readFailure()).tries).toBe(2);

    // And when the .perf finally parses, the failed row goes away -- otherwise
    // counts().failed never returns to 0 once anything has ever failed.
    const fixed = await indexInto(db, fixtureSource([AIR_A]), [AIR_A]);
    expect(fixed).toMatchObject({ runs: 1, curves: 1, failed: 0 });
    expect(await readFailure()).toBeUndefined();
  });

  it('keeps the batch when one file cannot be read', async () => {
    // A file deleted or locked mid-pass must cost that file, not the pass. The
    // read rejecting used to propagate out of readAll before the write
    // transaction opened, so all 12 of 12 stayed pending and nothing was
    // written at all.
    const ids = statsIds().slice(0, 3);
    const flaky: RunSource = {
      ...fixtureSource(ids),
      async read(id: string) {
        if (id === ids[1]) throw new Error('NotFoundError');
        return { stats: readStats(id), perf: readPerf(id) };
      },
    };
    const result = await indexInto(db, flaky, ids);
    expect(result.runs).toBe(2);
    expect(result.failed).toBe(1);
    // The unreadable one is still pending, because it was never marked indexed.
    expect(await pendingIds(db, fixtureSource(ids))).toEqual([ids[1]]);
  });

  it('upgrades a curve-less run when its .perf arrives', async () => {
    // The run lands from its CSV first; the .perf follows about two seconds
    // later. Indexing curve-less and upgrading is the same state the index
    // already carries for the one run in seven that never gets one.
    const noPerf: RunSource = {
      ...fixtureSource([AIR_A]),
      async read() { return { stats: readStats(AIR_A) }; },
    };
    await indexInto(db, noPerf, [AIR_A]);
    expect((await createStore(db).getRun(AIR_A))!.has_perf).toBe(false);

    await indexInto(db, fixtureSource([AIR_A]), [AIR_A], undefined, { force: true });
    const run = await createStore(db).getRun(AIR_A);
    expect(run!.has_perf).toBe(true);
    expect(run!.duration_s).toBeCloseTo(93.85209655761719, 8);
  });

  it('reclassifies a scenario when a second run changes the evidence', async () => {
    // Air Spectral Easy has no .perf at all, so one run cannot settle it: the
    // totals fallback needs two. The first run must chart as timed and the
    // second must promote the scenario to race.
    const source = fixtureSource([SPECTRAL_A, SPECTRAL_B]);
    await indexInto(db, source, [SPECTRAL_A]);
    expect((await createStore(db).getScenario('Air Spectral Easy'))!.shape).toBe('timed');

    await indexInto(db, source, [SPECTRAL_B]);
    const scenario = await createStore(db).getScenario('Air Spectral Easy');
    expect(scenario!.shape).toBe('race');
    expect(scenario!.evidence).toBe('csv-constant-budget');
    expect(scenario!.bots).toBe(6);
  });

  it('recomputes marks when a run arrives older than one already indexed', async () => {
    // A re-pick after a restored backup, or any out-of-order arrival. The
    // newer run's marks are empty until the older one lands, and must not stay
    // empty afterwards.
    const source = fixtureSource([AIR_A, AIR_B]);
    await indexInto(db, source, [AIR_B]);
    const before = await createStore(db).page(10, { sameCfg: true });
    expect(before[0]).toMatchObject({ id: AIR_B, best_before: null, played_before: 0 });

    await indexInto(db, source, [AIR_A]);
    const after = await createStore(db).page(10, { sameCfg: true });
    expect(after[0]).toMatchObject({
      id: AIR_B, best_before: 906.138184, played_before: 1,
    });
    expect(after[1]).toMatchObject({ id: AIR_A, played_before: 0 });
  });

  it('reports progress as it goes', async () => {
    const seen: string[] = [];
    await indexInto(db, fixtureSource(statsIds()), statsIds(),
      (p) => { if (!seen.includes(p.phase)) seen.push(p.phase); });
    expect(seen).toEqual(['reading', 'writing', 'classifying']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run test/indexer.test.ts`
Expected: `Failed to resolve import "../src/db/indexer"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/db/indexer.ts`:

```ts
/** Indexing N basenames into an existing database.
 *
 * There is one indexing path and a bootstrap is it over an empty database.
 * That is not tidiness: this is exactly the function an observer calls in step
 * two, and a bootstrap written separately would be a second implementation to
 * keep in agreement with it.
 */

import { ingest } from '../core/ingest';
import { materialiseMarks } from '../core/marks';
import { refreshScenario, type ScenarioInput } from '../core/scenario';
import { SERIES, type Curve, type Kill, type Run, type Scenario, type Shape } from '../core/types';
import { readAll } from '../source/pool';
import type { RunSource } from '../source/types';
import { pack, unpack, type PackedKills } from './packed';
import {
  done, MAX_TRIES, META_INDEXED, META_READ_AT, req,
  type StoredCurve, type StoredFailure, type StoredRun,
} from './schema';

export interface IndexProgress {
  phase: 'reading' | 'writing' | 'classifying';
  done: number;
  total: number;
}

export interface IndexResult {
  runs: number;
  curves: number;
  failed: number;
  skipped: number;
}

export interface IndexOptions {
  /** Re-read basenames already in the `indexed` set. Used to upgrade a run
   *  whose `.perf` arrived after its CSV. */
  force?: boolean;
  concurrency?: number;
}

async function indexedSet(db: IDBDatabase): Promise<Set<string>> {
  const row = await req<{ key: string; value: string[] } | undefined>(
    db.transaction('meta').objectStore('meta').get(META_INDEXED));
  return new Set(row?.value ?? []);
}

/** Which of the source's basenames are not in the database yet. */
export async function pendingIds(db: IDBDatabase, source: RunSource): Promise<string[]> {
  const known = await indexedSet(db);
  return (await source.list()).filter((id) => !known.has(id));
}

/** Every recorded failure, read in one request before any write opens.
 *
 * Read up front rather than looked up inside the write loop: an await on a
 * second request mid-transaction deactivates it, and the puts after it fail.
 */
async function failures(db: IDBDatabase): Promise<Map<string, StoredFailure>> {
  const rows = await req<StoredFailure[]>(
    db.transaction('failed').objectStore('failed').getAll());
  return new Map(rows.map((f) => [f.basename, f]));
}

function toStoredCurve(runId: string, curve: Curve): StoredCurve {
  const series = Object.fromEntries(
    SERIES.map((name) => {
      const view = curve.series[name];
      // slice() so the stored buffer is exactly this series and not a view
      // into a larger one.
      return [name, view.slice().buffer];
    }),
  ) as StoredCurve['series'];
  return { run_id: runId, buckets: curve.buckets, duration_s: curve.duration_s, series };
}

export async function indexInto(
  db: IDBDatabase,
  source: RunSource,
  ids: readonly string[],
  onProgress?: (p: IndexProgress) => void,
  options: IndexOptions = {},
): Promise<IndexResult> {
  const known = await indexedSet(db);
  const failed = await failures(db);
  const wanted = options.force ? [...ids] : ids.filter((id) => !known.has(id));
  const result: IndexResult = {
    runs: 0, curves: 0, failed: 0, skipped: ids.length - wanted.length,
  };
  if (!wanted.length) {
    // Record that we looked, even with nothing to do. Returning here without
    // writing read_at leaves the staleness badge with nothing to read -- on the
    // "nothing new" path, which is every refresh after the first.
    const meta = db.transaction('meta', 'readwrite');
    meta.objectStore('meta').put({ key: META_READ_AT, value: Date.now() });
    await done(meta);
    return result;
  }

  // Reading dominates a bootstrap -- 15 s of the design's 22 s at 12k runs --
  // and it is the only phase worth parallelising. The pool size is not
  // hard-coded: 8 to 32 is right on one machine, and high concurrency does not
  // help on a spinning disk or a network-redirected profile.
  const parsed: { run: Run; curve: Curve | null; kills: Kill[]; error?: string }[] = [];
  const unreadable = new Map<string, string>();
  let read = 0;
  await readAll(wanted, async (id) => {
    // One unreadable file must not discard the batch. Letting this reject
    // propagates out of readAll before the write transaction is even opened, so
    // a single file deleted or locked mid-pass costs all 12k runs and writes
    // nothing at all. A file that went away between listing and reading is
    // exactly what the failed store and MAX_TRIES exist for.
    try {
      const { stats, perf } = await source.read(id);
      if (stats !== undefined) parsed.push(ingest(id, stats, perf));
      // The picker source answers a vanished file with an empty result rather
      // than a throw, so an absent CSV is the same condition, not a no-op.
      else unreadable.set(id, 'the stats file could not be read');
    } catch (error) {
      unreadable.set(id, error instanceof Error ? error.message : String(error));
    }
    onProgress?.({ phase: 'reading', done: ++read, total: wanted.length });
  }, options.concurrency);

  // One transaction for the batch. Per-file transactions turn a bootstrap into
  // one commit per run, which is the browser equivalent of the Python's
  // one-fsync-per-file mistake: 3.6 s becomes 68 s.
  const write = db.transaction(
    ['runs', 'curves', 'kills', 'failed', 'meta'], 'readwrite');
  const runsStore = write.objectStore('runs');
  const curvesStore = write.objectStore('curves');
  const killsStore = write.objectStore('kills');
  const failedStore = write.objectStore('failed');

  const now = new Date().toISOString();

  // A file whose basename does not match the expected shape parses to an empty
  // scenario and an empty started_at. That is permanent -- re-reading it will
  // never produce anything -- so it is marked known and counted as skipped.
  // Leaving it out of `known` re-reads it on every pass for ever, and counting
  // it nowhere makes it invisible in the totals.
  for (const row of parsed) {
    if (row.run.scenario && row.run.started_at) continue;
    known.add(row.run.id);
    result.skipped += 1;
  }

  // Files that could not be read at all. Not added to `known`: the whole point
  // is that the next pass tries again.
  for (const [id, message] of unreadable) {
    const previous = failed.get(id);
    if ((previous?.tries ?? 0) < MAX_TRIES) {
      failedStore.put({
        basename: id, tries: (previous?.tries ?? 0) + 1,
        last_error: message, last_try: now,
      });
      result.failed += 1;
    } else {
      // Out of tries. Mark it known so it stops being re-read, and leave the
      // failed row standing as the record of why.
      known.add(id);
    }
  }

  const touched = new Set<string>();
  for (const [i, row] of parsed.entries()) {
    if (!row.run.scenario || !row.run.started_at) continue;
    touched.add(row.run.scenario);

    if (row.error !== undefined) {
      // `error` means the .perf was rejected, not that the run is bad: the CSV
      // parsed, so the run and its kills below are good and get written. What
      // is missing is the curve, and a half-written .perf becomes readable on
      // the next pass -- which is why this id is deliberately NOT added to
      // `known` until the budget runs out. Adding it unconditionally is what
      // makes MAX_TRIES unreachable dead code and rule 2 a dead letter.
      //
      // The previous count comes from the map read before this transaction
      // opened. Looking it up here would mean awaiting a request mid-write,
      // which deactivates the transaction and fails every put after it.
      const previous = failed.get(row.run.id);
      if ((previous?.tries ?? 0) < MAX_TRIES) {
        failedStore.put({
          basename: row.run.id,
          tries: (previous?.tries ?? 0) + 1,
          last_error: row.error,
          last_try: now,
        });
        result.failed += 1;
      } else {
        known.add(row.run.id);
      }
    } else {
      known.add(row.run.id);
      // A file that used to fail and now parses must stop being reported as
      // failed, or counts().failed never returns to 0 once anything has ever
      // failed. delete() on an absent key is a no-op, so this is unconditional.
      failedStore.delete(row.run.id);
    }

    const storedRun: StoredRun = {
      ...row.run,
      buckets: row.curve ? row.curve.buckets : null,
      // Filled by the marks pass below; written now so the record is complete
      // even if that pass is interrupted.
      marks: { cfg: { best_before: null, played_before: 0 },
               any: { best_before: null, played_before: 0 } },
    };
    runsStore.put(storedRun);
    result.runs += 1;

    if (row.curve) {
      curvesStore.put(toStoredCurve(row.run.id, row.curve));
      result.curves += 1;
    }
    killsStore.put(pack(row.run.id, row.kills));
    onProgress?.({ phase: 'writing', done: i + 1, total: parsed.length });
  }

  write.objectStore('meta').put({ key: META_INDEXED, value: [...known] });
  // The time of THIS pass, not source.pickedAt. pickedAt is set once, when the
  // handle was opened, and a re-pick reuses the same source object -- so
  // recording it would rewrite read_at backwards to 09:00 on a 14:00 refresh
  // and leave the staleness badge permanently unclearable.
  write.objectStore('meta').put({ key: META_READ_AT, value: Date.now() });
  await done(write);

  await reclassify(db, [...touched], onProgress);
  return result;
}

/** Recompute the shape and the marks of every scenario the batch touched.
 *
 * Over all of the scenario's runs, not just the new ones: a second run is
 * exactly what promotes a curveless race scenario out of 'timed', a scenario
 * becomes race on its first `.perf`, and a shape change moves which prior runs
 * count as peers -- so the marks move with it.
 */
async function reclassify(
  db: IDBDatabase, scenarios: readonly string[],
  onProgress?: (p: IndexProgress) => void,
): Promise<void> {
  let seen = 0;
  for (const name of scenarios) {
    const rows = await req<StoredRun[]>(
      db.transaction('runs').objectStore('runs').index('scen_time')
        .getAll(IDBKeyRange.bound([name, ''], [name, '￿'])));

    // Every request is issued synchronously and awaited together. Awaiting them
    // one at a time would let the transaction commit after the first, and the
    // rest would throw.
    const read = db.transaction(['curves', 'kills']);
    const curveRequests = rows.map((row) =>
      req<StoredCurve | undefined>(read.objectStore('curves').get(row.id)));
    const killRequests = rows.map((row) =>
      req<PackedKills | undefined>(read.objectStore('kills').get(row.id)));
    const [curves, packed] = await Promise.all([
      Promise.all(curveRequests), Promise.all(killRequests),
    ]);

    const inputs: ScenarioInput[] = rows.map((row, i) => ({
      run: row,
      score: curves[i] ? new Float32Array(curves[i]!.series.score) : null,
      kills: packed[i] ? unpack(packed[i]!) : [],
    }));

    const scenario = refreshScenario(name, inputs);
    if (!scenario) continue;
    const shapeOf = (): Shape => scenario.shape;
    const marks = materialiseMarks(rows, shapeOf);

    const write = db.transaction(['runs', 'scenarios'], 'readwrite');
    write.objectStore('scenarios').put(scenario satisfies Scenario);
    for (const row of rows) {
      const updated = marks.get(row.id);
      if (updated) write.objectStore('runs').put({ ...row, marks: updated });
    }
    await done(write);
    onProgress?.({ phase: 'classifying', done: ++seen, total: scenarios.length });
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run test/indexer.test.ts`
Expected: all passed.

- [ ] **Step 5: Run everything**

Run: `cd web && npm test && npx astro check`
Expected: all passed, `0 errors`.

- [ ] **Step 6: Commit**

```bash
git add web/src/db/indexer.ts web/test/indexer.test.ts
git commit -m "Index a batch of basenames into an existing database

One path, and a bootstrap is it over an empty database -- this is the function
an observer will call in step two, and a separate bootstrap would be a second
implementation to keep in agreement with it.

Reclassification is over every run of a touched scenario rather than the new
ones: a second run promotes a curveless race out of timed, and a shape change
moves which prior runs count as peers, so the marks move with it. The two cases
a real install cannot produce on demand -- an out-of-order insert and a shape
flip -- are what the tests cover."
```

**REVIEW CHECKPOINT — stop here.** A folder can be enumerated and its runs indexed into a database that can then be read. Everything after this is the UI.

---

### Task 6: Writer election

**Files:**
- Create: `web/src/db/writer.ts`

Two tabs share one database and will both try to index and both read-modify-write the maintained aggregates — a lost update that does not self-heal, because the aggregates are maintained rather than derived on read. Electing a writer is cheap now and very annoying to retrofit.

- [ ] **Step 1: Write `web/src/db/writer.ts`**

```ts
/** One writer per origin, elected with Web Locks.
 *
 * Two tabs would otherwise both index and both read-modify-write the
 * maintained aggregates -- the scenario records and the materialised marks --
 * and a lost update there does not self-heal, because those are maintained
 * rather than derived on read.
 *
 * The loser is not broken: it reads the same database and sees the winner's
 * writes. It simply does not write -- until the winner goes away, at which
 * point it is promoted and takes over. `elected` is therefore a live flag, not
 * a snapshot taken at boot.
 */

const LOCK = 'aimcurve-writer';

export interface Writer {
  /** Whether this tab holds the write lock *now*. False for a tab that lost,
   *  and true from the moment it is promoted. Read it, do not cache it. */
  readonly elected: boolean;
  release(): void;
}

/** Try to become the writer, without waiting for another tab to finish. */
export function electWriter(): Promise<Writer> {
  let elected = false;
  let release = () => {};
  const writer: Writer = {
    get elected() { return elected; },
    release() { release(); elected = false; },
  };

  if (!navigator.locks) {
    // Fail closed: a reader, not a writer.
    //
    // The trigger is a non-secure context -- navigator.locks is undefined over
    // plain http://, which is exactly how this static build gets served off
    // another machine on a LAN. It is not a browser-age problem: Safari 15.4+
    // and Firefox 96+ both ship Web Locks.
    //
    // Electing every tab here would guarantee the lost update this module
    // exists to prevent, rather than merely risking it. A degraded read-only
    // tab is the better failure; serve over https:// or localhost to write.
    return Promise.resolve(writer);
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = () => { if (!settled) { settled = true; resolve(writer); } };

    // Holding the lock for the life of the tab is the point: releasing it after
    // the bootstrap would let a second tab start writing while this one is
    // still reading its own aggregates.
    const hold = () => new Promise<void>((r) => { release = r; });

    navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
      if (lock === null) {
        // Lost. Start as a reader immediately rather than blocking boot behind
        // the winner's bootstrap, then queue for the lock so that closing the
        // winner promotes this tab. Without this second request the survivor of
        // two tabs is read-only for ever -- and on a fresh origin that is an
        // empty dashboard that never fills, no matter how long it is left open.
        settle();
        navigator.locks.request(LOCK, () => {
          elected = true;
          return hold();
        }).catch(() => { /* promotion is best-effort; stay a reader */ });
        return Promise.resolve();
      }
      elected = true;
      settle();
      return hold();
    }).catch(settle);
    // request() rejects when the document is not fully active, on an opaque
    // origin, and on InvalidStateError. Its promise is separate from the
    // callback, so without that .catch the returned promise never settles at
    // all and boot hangs on a blank shell with the rejection only in console.
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx astro check`
Expected: `0 errors`.

- [ ] **Step 3: Commit**

```bash
git add web/src/db/writer.ts
git commit -m "Elect one writer per origin

Two tabs both maintaining the scenario records and the marks is a lost update
that does not self-heal. ifAvailable so the loser starts immediately as a
reader rather than blocking behind the winner, a second blocking request so
that closing the winner promotes the survivor instead of leaving it read-only
for ever, and the lock is held for the life of the tab.

No Web Locks means a non-secure context, not an old browser, so it fails closed
as a reader: electing every tab would guarantee the lost update rather than
risk it."
```

---

### Task 7: Move the dashboard and repoint its fetch layer

**Files:**
- Move: `aimcurve/web/app.js` → `web/src/ui/app.js`
- Move: `aimcurve/web/style.css` → `web/src/ui/style.css`
- Move: `aimcurve/web/vendor/` → `web/public/vendor/`
- Create: `web/src/ui/api-shim.js`
- Modify: `web/src/ui/app.js` (every edit is listed below, in Steps 3–8)

`app.js` is 1019 lines and none of its rendering changes. Two things do: run ids are strings now, and there is no server to fetch from.

Move with `git mv` so the history follows. `index.html` does **not** move — Task 8 rewrites it as an Astro page.

**Vendor goes to `web/public/`, not `web/src/`.** uPlot's IIFE build publishes its global only when it runs as a classic top-level `<script>`, and Astro serves `public/` but not `src/`. From `src/` the only route left is a bundled `import`, where `var uPlot` is module-scoped and invisible to `app.js` — and `app.js:194` calls `uPlot.sync('kv')` at module evaluation, so the page dies with a `ReferenceError` before a pixel renders. Keep exactly one copy, in `public/`.

- [ ] **Step 1: Move the files**

```bash
mkdir -p web/src/ui
git mv aimcurve/web/app.js web/src/ui/app.js
git mv aimcurve/web/style.css web/src/ui/style.css
git mv aimcurve/web/vendor web/public/vendor
```

- [ ] **Step 2: Write the shim `app.js` will call**

Create `web/src/ui/api-shim.js`:

```js
/* The seam. app.js asked a server these five questions; now it asks the page.
   Same paths, same query strings, same payload shapes — which is what lets
   app.js move over near-verbatim and what lets the oracle diff keep meaning
   something about what the browser actually renders. */

import { getHealth, getRun, getRuns, getScenarios, getSession } from '../core/api';

/** Set once at boot, before app.js runs. */
let store = null;
export function useStore(next) { store = next; }

const flag = (params, name, fallback) =>
  (params.get(name) ?? fallback) !== '0';

export async function api(path) {
  if (!store) throw new Error('no store');
  const [route, query] = path.split('?');
  const p = new URLSearchParams(query || '');

  if (route === '/api/health') return getHealth(store);

  if (route === '/api/runs') {
    return getRuns(store, {
      limit: Number(p.get('limit') ?? 50),
      scenario: p.get('scenario') || null,
      before: p.get('before') || null,
      sameCfg: flag(p, 'same_cfg', '1'),
    });
  }

  if (route === '/api/scenarios') return getScenarios(store);

  if (route === '/api/session/today') {
    return getSession(store, p.get('day') || undefined);
  }

  if (route.startsWith('/api/run/')) {
    const id = decodeURIComponent(route.slice('/api/run/'.length));
    return getRun(store, id, {
      metric: p.get('metric') ?? 'score',
      smoothing: Number(p.get('smoothing') ?? 5),
      recentN: Number(p.get('recent_n') ?? 10),
      sameCfg: flag(p, 'same_cfg', '1'),
    });
  }

  throw new Error(`no such route: ${route}`);
}
```

- [ ] **Step 3: Repoint `app.js`'s fetch layer**

In `web/src/ui/app.js`, replace:

```js
const API = '';                    // same origin
```

with nothing, and replace the whole fetch layer:

```js
/* ── fetch layer ─────────────────────────────────────────── */
async function api(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
```

with:

```js
/* ── fetch layer ─────────────────────────────────────────── */
/* Answered in this tab, from IndexedDB, by exactly the code the Python's HTTP
   handlers used to call. Nothing is requested over the network and nothing
   leaves the machine. */
import { api } from './api-shim.js';
```

Because `app.js` is wrapped in an IIFE, hoist the import to the top of the file, above it — ES module imports cannot appear inside a function. Task 8 loads `app.js` as a module, which is what makes that legal.

- [ ] **Step 4: Make run ids strings**

Ten edits, each a single line. Line numbers are from the file as it stands before this task.

| Site | Before | After |
|---|---|---|
| `parseHash`, ~117 | `runId: view === 'run' && /^\d+$/.test(seg[1] \|\| '') ? +seg[1] : null` | `runId: view === 'run' && seg[1] ? decodeURIComponent(seg[1]) : null` |
| `loadRun`, ~782 | `` api(`/api/run/${id}?metric=...`) `` | `` api(`/api/run/${encodeURIComponent(id)}?metric=...`) `` |
| `formatHash`, ~124 | `(runId == null ? '' : '/' + runId)` | `(runId == null ? '' : '/' + encodeURIComponent(runId))` |
| `loadMore`, ~180 | `'&before=' + A.runs[A.runs.length - 1].id` | `'&before=' + encodeURIComponent(A.runs[A.runs.length - 1].id)` |
| `applyRoute`, ~825 | `findIndex(el => +el.dataset.id === id)` | `findIndex(el => el.dataset.id === id)` |
| rail click, ~943 | `go({ runId: +li.dataset.id })` | `go({ runId: li.dataset.id })` |
| session click, ~957 | `runId: +tr.dataset.run` | `runId: tr.dataset.run` |
| keyboard move, ~982 | `go({ runId: +el.dataset.id }, true)` | `go({ runId: el.dataset.id }, true)` |
| keyboard move, ~983 | `loadRun(+el.dataset.id)` | `loadRun(el.dataset.id)` |
| `renderRunList`, ~701 | `` ol.querySelector(`[data-id="${newId}"]`) `` | `` ol.querySelector(`[data-id="${cssEscape(newId)}"]`) `` |

**The `loadRun` edit is the one that is easy to miss, and it is the one that bites.** Run ids are KovaaK's basenames, so every reserved character is reachable in real scenario names:

```
"Pokeball Frenzy 100% - ..."  -> URIError: URI malformed, thrown out of loadRun
"Is it a hit? - ..."          -> id truncated at the '?', and all four options
                                 silently revert to the shim's defaults
```

The `?` case is the dangerous one because it is silent: `getRun` throws `UnknownRunError`, `applyRoute` swallows it and falls back to `A.runs[0]`, and the user is shown **a different run than the one they clicked, at the wrong smoothing, with no error anywhere.** `loadRun` has no `catch` at three of its five call sites.

- [ ] **Step 5: Escape what now goes into HTML attributes**

A run id is a scenario name plus a timestamp, and a scenario name can contain a double quote. That hazard already existed for scenario names; putting ids in attributes makes it reachable from more places, so fix it here rather than leaving it.

Add near the other helpers at the top of `app.js`:

```js
/* Scenario names are the game's, not ours, and they reach the DOM through
   template strings. A name containing a quote would otherwise break out of the
   attribute it sits in. */
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/* querySelector needs CSS escaping, which is a different alphabet from HTML's. */
const cssEscape = s => (window.CSS && CSS.escape) ? CSS.escape(s)
  : String(s).replace(/["\\]/g, '\\$&');
```

Then wrap these seven interpolations:

| Line | Before | After |
|---|---|---|
| ~688 | `data-id="${r.id}"` | `data-id="${esc(r.id)}"` |
| ~694 | `<span class="name">${r.scenario}</span>` | `<span class="name">${esc(r.scenario)}</span>` |
| ~747 | `<tr data-run="${rs.at(-1).id}">` | `<tr data-run="${esc(rs.at(-1).id)}">` |
| ~747 | `<td class="name">${nm}</td>` | `<td class="name">${esc(nm)}</td>` |
| ~770 | `data-scenario="${s.scenario}" ... <td class="name">${s.scenario}</td>` | `data-scenario="${esc(s.scenario)}" ... <td class="name">${esc(s.scenario)}</td>` |
| `renderSplits`, ~528 | `<td class="bot">${s.bot}</td>` | `<td class="bot">${esc(s.bot)}</td>` |
| `renderWindows`, ~571 | `<td class="bot">${r.bot}</td>` | `<td class="bot">${esc(r.bot)}</td>` |

Bot names are game data on exactly the same footing as scenario names — they come out of the `.perf` file, not out of aimcurve — so they need the same treatment. They are easy to overlook because they are the only unescaped interpolations outside the rail and the tables above.

- [ ] **Step 6: Stop the empty state promising a watcher**

Nothing watches the folder any more — the page reads a snapshot taken when the user last picked. Two strings in the empty state still say otherwise, and because `getHealth` hardcodes `awaiting_perf: 0` the `awaiting_perf` branch is dead and the **false** side is what always renders:

| Line | Before | After |
|---|---|---|
| ~864 | `'aimcurve is watching your stats folder'` | `'Snapshot of your stats folder'` |
| ~873 | `'The next run you finish lands here about a second after it ends.'` | `'Play a scenario, then use Re-read folder to pick it up.'` |

Leave the `awaiting_perf ?` conditionals themselves in place; Task 9 gives the badge something true to say.

- [ ] **Step 7: Retire the SSE client**

There is no event stream in this plan. Replace the whole `SSE` block's `connect()` body and the boot line.

Replace:

```js
let es = null, retry = 0;
function connect() {
  setStatus('connecting', 'connecting');
  es = new EventSource(API + '/events');
  es.onopen = () => { retry = 0; setStatus('live', 'live'); };
  es.onmessage = ev => {
    let m = {}; try { m = JSON.parse(ev.data); } catch (_) {}
    if (m.type === 'run') refresh(true);
  };
  es.onerror = () => {
    es.close();
    retry = Math.min(retry + 1, 6);
    setStatus('down', `reconnecting ${retry * 2}s`);
    setTimeout(connect, retry * 2000);
  };
}
```

with:

```js
/* No event stream: this tier reads the folder once, when you pick it. The
   status badge therefore reports the data's age rather than a connection --
   the app knows when it last looked and nothing about what has happened
   since. Step two replaces this with a FileSystemObserver. */
export function setSnapshotAge(label) { setStatus('snapshot', label); }
```

and replace the boot line:

```js
refresh(false).then(connect);
```

with:

```js
export function start() { return refresh(false); }
```

`refresh()` must also stop reacting to `awaiting_perf` and `watcher_errors` as live conditions — leave the code, since `getHealth` reports both as 0, and Task 9 gives the badge something true to say.

- [ ] **Step 8: Make the module's exports reachable**

`app.js` is wrapped in an IIFE and exporting from inside one is not legal. Remove the wrapper entirely — a module has its own scope, which is what the IIFE was for.

The opening is an **arrow** IIFE, at `app.js:3`:

```js
(() => {
'use strict';
```

Delete those two lines and the closing `})();`, then de-indent if the file indents inside them. (Searching for `(function () {` finds nothing — that is a different wrapper than the one this file actually uses.)

- [ ] **Step 9: Add a status style for the new state**

In `web/src/ui/style.css`, find the `[data-state=...]` rules on `#status` and add a `snapshot` variant alongside `live`, `connecting` and `down`. Use the same treatment as `live` but in the muted colour — this state is normal, not a warning.

- [ ] **Step 10: Type-check and test**

Run: `cd web && npm test && npx astro check`
Expected: all passed, `0 errors`. `astro check` will not type-check `app.js` unless `checkJs` is on; leave it off.

- [ ] **Step 11: Commit**

```bash
git add -A web/src/ui aimcurve/web
git commit -m "Move the dashboard into the app and answer its questions locally

app.js keeps every line of its rendering. What changes is that run ids are
basenames rather than row counters, and that api() dispatches to core/api in
this tab instead of fetching -- same paths, same query strings, same payload
shapes, which is what lets the oracle diff still say something about what the
browser renders.

Scenario names reach the DOM through template strings and can contain a quote.
That hazard predates this change; putting ids in attributes makes it reachable
from more places, so it is escaped here rather than left."
```

**REVIEW CHECKPOINT — stop here.** The UI is in place but has nothing to read yet.

---

### Task 8: The shell, and the first run

**Files:**
- Create: `web/src/pages/index.astro`
- Create: `web/src/boot.ts`
- Delete: `aimcurve/web/index.html` (its markup moves into the Astro page)

The first thing a new user does is read a dialog that says *"Upload 11,000 files to this site?"* — which is Chrome's wording for a directory pick, and which is wrong about what happens. **The page must say so before the dialog opens.** This is not a nicety; it is the single most important sentence on the page.

- [ ] **Step 1: Write the shell**

Create `web/src/pages/index.astro`, carrying over the whole body of `aimcurve/web/index.html` between `<body>` and `</body>`, and adding the picker panel in front of it.

**Do not wrap the carried-over markup in a container.** `style.css:42-46` sizes the whole dashboard off a body grid — `body { display:grid; grid-template-rows:auto minmax(0,1fr) }`, whose two rows are `<header class="topbar">` and `<main class="view run-view">`. A wrapping `<main id="app">` is a plain block, so the `minmax(0,1fr)` chain that bounds the charts and the rail never reaches them and the layout collapses. It would also nest `<main>` inside `<main>`, which the spec forbids, because the carried markup already has one. Toggle a class on `<body>` instead and keep every dashboard element a direct child of it.

```astro
---
import '../ui/style.css';
---

<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>aimcurve</title>
  <link rel="stylesheet" href="/vendor/uPlot.min.css" />
</head>
<body class="picking">
  <section id="pick" class="pick">
    <h1>aimcurve</h1>
    <p class="lede">Your KovaaK's run history, read in this tab.</p>
    <p class="promise">
      <strong>Nothing is uploaded.</strong> Your browser will ask to
      &ldquo;upload&rdquo; the folder &mdash; that is its wording for granting
      read access, and it is wrong here. The files are read in this tab, the
      index is stored on this machine, and no request leaves it.
    </p>
    <p class="promise">aimcurve never writes to your KovaaK's install.</p>

    <!-- Exactly one of these is shown. Two identically-labelled controls side
         by side is a coin toss, and the picker's error handler says "try the
         folder button below instead" -- which has to refer to something the
         user can tell apart. boot.ts reveals #pickDir and hides #pickUploadLabel
         when showDirectoryPicker exists, and leaves this default otherwise. -->
    <div class="pick-actions">
      <button id="pickDir" hidden>Choose your KovaaK's folder</button>
      <label class="button" id="pickUploadLabel" for="pickUpload">Choose folder (upload)</label>
      <input id="pickUpload" type="file" webkitdirectory multiple hidden />
    </div>
    <p class="hint">
      The folder that contains <code>stats</code> and
      <code>performances</code>. On a default install that is
      <code>…\steamapps\common\FPSAimTrainer\FPSAimTrainer</code>.
    </p>

    <p id="pickProgress" class="progress" hidden></p>
    <p id="pickError" class="error" hidden></p>
  </section>

  <!-- Carried over verbatim from aimcurve/web/index.html, and staying direct
       children of <body> so the body grid still sizes them. `body.picking`
       hides them; boot.ts drops that class when there is something to show.

       Two edits to the carried markup, both in the topbar:
         - #status ships data-state="stale", not "live" (see below)
         - #repick is added next to it -->
  <header class="topbar">
    <!-- ... brand and nav, verbatim ... -->
    <div class="top-right">
      <div class="health" id="health" hidden></div>
      <button id="repick" class="button ghost">Re-read folder</button>
      <div class="status" id="status" data-state="stale">
        <span class="dot" aria-hidden="true"></span>
        <span class="status-label">—</span>
      </div>
    </div>
  </header>
  <main class="view run-view" id="view-run">
    <!-- ... carried over verbatim ... -->
  </main>

  <script src="/vendor/uPlot.iife.min.js" is:inline></script>
  <script>
    import '../boot.ts';
  </script>
</body>
</html>
```

**The status badge must not ship saying "live" in green.** The carried markup is `data-state="live"` with the label `live`, and nothing overwrites it until `setSnapshotAge` runs *after* `await start()` — hundreds of milliseconds on a real corpus, and for ever if `start()` rejects. There is no live anything in this plan: no watcher, no event stream. Ship it neutral and let the first real reading fill it in. Add a `.status[data-state="stale"]` rule in Step 3 alongside the picker styles.

`#repick` belongs here rather than in Task 9. Task 9 gives it its behaviour, but `showDashboard` hides `#pick`, so without a control in the topbar a returning visitor at this commit has no way to re-read their folder at all — their only option is clearing site data. That contradicts the plan's own rule that at every earlier commit there is still something that runs. Wire it to a plain `location.reload()` here; Task 9 replaces that.

- [ ] **Step 2: Write the boot sequence**

Create `web/src/boot.ts`:

```ts
/** Choosing a source, building the index, starting the dashboard.
 *
 * Order matters in one place: the database is opened and read *before* any
 * picking, so a returning visitor sees their history immediately rather than
 * being asked for a folder they already chose. The cost of that is that what
 * they see is as old as the last read, which is why the age is reported.
 */

import { createStore } from './db/idbstore';
import { indexInto, pendingIds } from './db/indexer';
import {
  META_READ_AT, openDatabase, req, requestPersistence, META_PERSISTED,
} from './db/schema';
import { electWriter } from './db/writer';
import { pickDirectory, pickerSource, supportsPicker } from './source/picker';
import type { RunSource } from './source/types';
import { uploadSource } from './source/upload';
import { useStore } from './ui/api-shim.js';

// app.js is imported dynamically, and that is load-bearing. It does DOM work at
// module evaluation -- `uPlot.sync('kv')` at :194, `ro.observe` at :477,
// loadCtrl()/buildSegs() at :896, a hashchange listener at :828 -- all before
// start() is ever called. A static `import { start } from './ui/app.js'` runs
// every one of those the moment boot.ts is evaluated, which is before main()
// has called useStore(). So the shim must be pointed at a store BEFORE this
// import is awaited, not merely before start() is called.
let ui: typeof import('./ui/app.js') | null = null;
async function loadUi() {
  if (!ui) ui = await import('./ui/app.js');
  return ui;
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function lastReadAt(db: IDBDatabase): Promise<number | null> {
  const row = await req<{ value: number } | undefined>(
    db.transaction('meta').objectStore('meta').get(META_READ_AT));
  return row?.value ?? null;
}

/** Past which age the UI stops being quiet about it. One place, because Task 9
 *  styles the control off the same threshold the label is computed from. */
export const STALE_MS = 60 * 60_000;

/** The bare age -- 'just now', '5 min ago'. Callers add any prefix, so that the
 *  null case does not have to read "read never". */
function describeAge(readAt: number | null): string {
  if (readAt === null) return 'never';
  const ms = Date.now() - readAt;
  // A clock that moved backwards, or a file written by a machine slightly ahead
  // of this one, gives a negative age. Rounding that would print "-3 min ago";
  // it passed the old `< 2` test and rendered "just now" only by accident.
  if (ms <= 0) return 'just now';
  // floor, not round, everywhere. Rounding made 59 min 40 s print "1 h ago"
  // while the styling -- which compares the raw age against one hour -- still
  // called it fresh, so the label and the colour disagreed for twenty seconds
  // out of every hour.
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** 'read 5 min ago', or 'never read' -- never 'read never'. */
function describeRead(readAt: number | null): string {
  return readAt === null ? 'never read' : `read ${describeAge(readAt)}`;
}

async function showDashboard(db: IDBDatabase): Promise<void> {
  // useStore first, then the import: see the note on loadUi above.
  useStore(createStore(db));
  const { setSnapshotAge, start } = await loadUi();
  // Not `el('app').hidden = false`: the dashboard's elements are direct
  // children of <body> so that the body grid can size them, and a class is
  // what reveals them.
  document.body.classList.remove('picking');
  await start();
  setSnapshotAge(describeRead(await lastReadAt(db)));
}

/** Say something in whichever panel is actually on screen.
 *
 * #status lives in the topbar, which `body.picking` hides -- so a message
 * written there before the dashboard is revealed is written into a hidden
 * element and the user sees nothing at all.
 */
async function announce(message: string): Promise<void> {
  if (document.body.classList.contains('picking')) {
    const progress = el<HTMLParagraphElement>('pickProgress');
    progress.hidden = false;
    progress.textContent = message;
  } else {
    (await loadUi()).setSnapshotAge(message);
  }
}

async function indexFrom(db: IDBDatabase, source: RunSource): Promise<void> {
  // Not `el('pickProgress')` directly: on a re-index the dashboard is already
  // up and #pick is hidden, so writing there gives a 22-second pass with no
  // feedback whatsoever. `announce` picks whichever panel is on screen.
  await announce('Looking at the folder…');

  const pending = await pendingIds(db, source);
  if (!pending.length) {
    await announce('Nothing new.');
  } else {
    let last = 0;
    await indexInto(db, source, pending, (p) => {
      // At 12k runs this fires 12,000 times; repainting on every one is most of
      // what makes the pass feel slow. Four times a second is plenty.
      if (p.done !== p.total && Date.now() - last < 250) return;
      last = Date.now();
      void announce(p.phase === 'reading'
        ? `Reading ${p.done} of ${p.total} runs…`
        : p.phase === 'writing'
          ? `Storing ${p.done} of ${p.total}…`
          : `Classifying ${p.done} of ${p.total} scenarios…`);
    });
  }

  // After the first successful bootstrap, not before: asking for persistence
  // with an empty database spends the user's one prompt on nothing.
  const persisted = await requestPersistence();
  const write = db.transaction('meta', 'readwrite');
  write.objectStore('meta').put({ key: META_PERSISTED, value: persisted });

  await showDashboard(db);
}

async function main(): Promise<void> {
  const db = await openDatabase();
  const writer = await electWriter();
  const store = createStore(db);
  const counts = await store.counts();

  // A returning visit renders immediately. The index is a cache with no source
  // attached, so it is shown with its age rather than withheld.
  if (counts.runs > 0) {
    await showDashboard(db);
  }

  const fail = async (message: string) => {
    if (!document.body.classList.contains('picking')) {
      // Past the first index #pickError is inside the hidden panel, so an error
      // written there is invisible. Say it where the user is looking.
      await announce(message);
      return;
    }
    const error = el<HTMLParagraphElement>('pickError');
    error.hidden = false;
    error.textContent = message;
  };

  // Task 9 replaces this with a real re-pick. Until then a reload is enough to
  // mean the control is not a lie.
  el<HTMLButtonElement>('repick').addEventListener(
    'click', () => location.reload());

  if (!writer.elected) {
    // Another tab owns the writing. This one reads, and says so wherever the
    // user is actually looking.
    //
    // Returning here before the controls below are bound is what made an empty
    // database in a second tab a terminal dead end: #pick stayed on screen with
    // a visible folder button that opened the directory dialog and then did
    // nothing at all, for ever, because no change listener had been attached.
    await announce(counts.runs > 0
      ? 'another tab is indexing'
      : 'Another aimcurve tab is indexing this folder. This tab will show your ' +
        'history once that finishes — reload to check.');
    el<HTMLButtonElement>('pickDir').hidden = true;
    el<HTMLLabelElement>('pickUploadLabel').hidden = true;
    return;
  }

  if (supportsPicker()) {
    // Exactly one control, so that "try the folder button below instead" names
    // something distinguishable.
    const button = el<HTMLButtonElement>('pickDir');
    button.hidden = false;
    el<HTMLLabelElement>('pickUploadLabel').hidden = true;
    button.addEventListener('click', async () => {
      const handle = await pickDirectory();
      if (!handle) return;
      try {
        await indexFrom(db, await pickerSource(handle));
      } catch (e) {
        // Chrome refuses any directory under Program Files, by every route.
        // The upload control is not subject to that, so bring it back and point
        // at it -- the message has to name a control that is actually on screen.
        el<HTMLLabelElement>('pickUploadLabel').hidden = false;
        await fail(`${(e as Error).message}. Try “Choose folder (upload)” instead.`);
      }
    });
  }

  el<HTMLInputElement>('pickUpload').addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files?.length) return;
    try {
      await indexFrom(db, uploadSource(files));
    } catch (e) {
      await fail((e as Error).message);
    } finally {
      // Chrome fires no `change` when the same directory is chosen twice in a
      // row unless the value is cleared -- and re-picking the same folder is
      // the common case, not the rare one.
      input.value = '';
    }
  });
}

main().catch((e) => {
  const error = document.getElementById('pickError');
  if (error) {
    error.hidden = false;
    error.textContent = String(e);
  }
});
```

- [ ] **Step 3: Style the picker panel**

Add rules for `.pick`, `.lede`, `.promise`, `.pick-actions`, `.button`, `.button.ghost`, `.hint`, `.progress` and `.error` to `web/src/ui/style.css`, following the variables already defined at the top of that file. The `.promise` paragraphs should read as reassurance rather than as a warning — they are the answer to a question the browser is about to ask badly.

Three more rules carry the panel toggle and the new badge state:

```css
/* The dashboard is sized by the body grid (grid-template-rows:auto minmax(0,1fr)
   at :46), so its elements have to stay direct children of <body>. Showing and
   hiding a whole panel is therefore a class on <body>, not a wrapper element. */
body.picking > :not(#pick) { display: none }
body:not(.picking) > #pick { display: none }
body.picking { grid-template-rows: minmax(0, 1fr) }

/* There is nothing live to report: no watcher, no event stream. */
.status[data-state="stale"] { color: var(--faint) }
```

- [ ] **Step 4: Delete the old shell**

```bash
git rm aimcurve/web/index.html
```

This empties `aimcurve/web/`, so it no longer exists as a path. `git rm` has already staged the deletion, which is why Step 6 commits with `git add -A web` alone — naming `aimcurve/web` there would match nothing and abort the whole command with exit 128.

- [ ] **Step 5: Build and look at it**

Run: `cd web && npx astro check`
Expected: `0 errors`. **`astro build` does not type-check**, and `boot.ts` has the widest cross-module type surface in this plan — the shim, the store, the indexer, the writer and both sources all meet here. Running only the build would let every one of those mismatches through.

Run: `cd web && npm run dev`
Open the printed URL. Expected: the picker panel, with the "nothing is uploaded" paragraph above a single folder button. The status badge in the topbar is not visible yet, and when it becomes visible it is grey and reads `—`, never green and `live`.

Run: `cd web && npm run build`
Expected: a `dist/` directory with `index.html` and hashed assets, and no error.

- [ ] **Step 6: Commit**

```bash
git add -A web
git commit -m "Add the shell and the first-run flow

The page contradicts the browser's own dialog before it opens: Chrome says
'Upload N files to this site' for a directory pick, which is wrong about what
happens, and it is the first thing a new user reads.

A returning visit renders from the cache before anything is asked for -- the
index exists precisely so that a second visit does not re-read 22,000 files --
and persistence is requested after the first successful bootstrap rather than
before, so the one prompt is not spent on an empty database."
```

---

### Task 9: Staleness and re-picking

**Files:**
- Modify: `web/src/boot.ts`
- Modify: `web/src/db/schema.ts` (two more meta keys)
- Modify: `web/src/pages/index.astro`
- Modify: `web/src/ui/style.css`

**A cache with no source is stale, and must say so.** The app knows when it last read the folder and nothing about what has happened since. That is the honest thing to report, and re-picking must be one obvious click — not a page reload, not a menu.

The browser design left *how loudly* open. The decision here: **state the age, always; prompt only past an hour.** A snapshot ten minutes old is not worth interrupting anyone about; one from yesterday is, because the user has almost certainly played since.

- [ ] **Step 1: Give the re-pick control its real markup**

Task 8 already put a placeholder `#repick` in the topbar next to `#status`, bound to `location.reload()`, so that there was a way back at that commit. Replace the placeholder in `web/src/pages/index.astro` with:

```html
<button id="repick" class="repick" data-stale="0" title="Read the folder again">
  <span id="repickAge">—</span>
  <span class="repick-do">refresh</span>
</button>
```

and drop the `location.reload()` binding from `boot.ts` — Step 2 replaces it.

- [ ] **Step 2: Keep the source and wire the button**

In `web/src/boot.ts`, hold the last source used and re-run the incremental path against it:

```ts
/** The source this tab last read from. A picker handle stays usable across a
 *  reload -- but only if it was stored, because this is a module-level `let`
 *  and a reload empties it. An upload snapshot cannot be stored at all, so it
 *  needs the dialog again. That difference is the whole gap between this tier
 *  and step two. */
let current: RunSource | null = null;

/** A directory handle survives a reload only if it is put in IndexedDB --
 *  structured clone handles them, and nothing else does. Without this, `current`
 *  is null after every reload and a picker user is silently downgraded to
 *  re-enumerating their whole install through the upload dialog. */
async function saveHandle(db: IDBDatabase, handle: FileSystemDirectoryHandle) {
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key: META_HANDLE, value: handle });
  await done(tx);
}

/** Restore it, and re-ask for permission.
 *
 * A stored handle is not a standing grant: after a restart the permission is
 * back to 'prompt', and requestPermission() must be called from a user gesture.
 * It can also come back 'denied' -- the folder moved, or the user revoked it --
 * which is a normal outcome and not an error. Null means "fall back to asking".
 */
async function restoreHandle(db: IDBDatabase): Promise<FileSystemDirectoryHandle | null> {
  const row = await req<{ value: FileSystemDirectoryHandle } | undefined>(
    db.transaction('meta').objectStore('meta').get(META_HANDLE));
  const handle = row?.value;
  if (!handle) return null;
  const opts = { mode: 'read' as const };
  if (await (handle as any).queryPermission(opts) === 'granted') return handle;
  return await (handle as any).requestPermission(opts) === 'granted' ? handle : null;
}

async function repick(db: IDBDatabase): Promise<void> {
  const handle = current?.kind === 'picker' ? null : await restoreHandle(db);
  if (current?.kind === 'picker') {
    await indexFrom(db, current);
    return;
  }
  if (handle) {
    await indexFrom(db, await pickerSource(handle));
    return;
  }
  // The upload path opens Chrome's "Upload N files to this site?" dialog. The
  // preamble is emphatic that the page must contradict that wording BEFORE the
  // dialog appears -- and re-pick is every read after the first, not an edge
  // case. Clicking the input while #pick is hidden fires that dialog with
  // nothing on screen answering it.
  document.body.classList.add('picking');
  el<HTMLInputElement>('pickUpload').click();
}

function renderAge(readAt: number | null): void {
  el('repickAge').textContent = describeAge(readAt);
  // The same threshold the label is computed from, so the colour and the words
  // can never disagree. See STALE_MS and the floor/round note in Task 8.
  const stale = readAt !== null && Date.now() - readAt > STALE_MS;
  el('repick').dataset.stale = stale ? '1' : '0';
}
```

Add `META_HANDLE` to `db/schema.ts` alongside the other meta keys. Set `current` in `indexFrom`, call `saveHandle` when a picker source is chosen, call `renderAge` from `showDashboard`, refresh it on a one-minute interval so the label does not freeze at "just now", and bind `#repick`'s click to `repick(db)`.

- [ ] **Step 3: Notice when the folder is not the same folder**

`pendingIds` is a pure set difference and `indexInto` only ever adds, so picking a *different* install merges the two into one rail permanently, with no way to separate them afterwards. Nothing records which folder the index came from. Record one, and ask before merging:

```ts
/** The folder this index was built from. Not an identity -- two installs can
 *  share a name -- but enough to catch the case that silently corrupts the
 *  index, which is picking a different folder by accident. */
async function checkSameFolder(db: IDBDatabase, name: string): Promise<boolean> {
  const row = await req<{ value: string } | undefined>(
    db.transaction('meta').objectStore('meta').get(META_ROOT_NAME));
  if (row?.value === undefined || row.value === name) return true;
  return confirm(
    `This index was built from “${row.value}”, and you picked “${name}”.\n\n` +
    `Adding it will merge both installs into one history, permanently. ` +
    `Cancel to keep the existing index.`);
}
```

Call it from `indexFrom` before indexing, bail if it returns false, and write `META_ROOT_NAME` after a successful pass.

**Two things this deliberately does not solve**, both of which need a product decision rather than a patch — flag them rather than inventing an answer:

- A *replace* option. Today the only choices are merge or cancel; there is no "forget the old one and start again" short of clearing site data.
- **Deleted runs never leave the index.** The set difference only ever grows it, so a run deleted from disk stays in the rail for ever. Reconciling would mean diffing the full listing against `META_INDEXED` on every pass and deleting the difference, which is a real change to the indexing contract.

- [ ] **Step 4: Style the two states**

`[data-stale="0"]` is quiet — the muted colour, no border. `[data-stale="1"]` gets the accent treatment the `#status` down state already uses. Nothing animates and nothing blocks the page; the data on screen is still real, it is just old.

- [ ] **Step 5: Verify**

Run: `cd web && npx astro check`
Expected: `0 errors`.

Run: `cd web && npm run dev`
Expected: the age reads "just now" after an index, and the control is quiet. Re-pick with a picker handle re-reads with no dialog; re-pick without one shows the picker panel, with the "nothing is uploaded" paragraph, *before* the browser's upload dialog appears.

- [ ] **Step 6: Commit**

```bash
git add web/src/boot.ts web/src/db/schema.ts web/src/pages/index.astro web/src/ui/style.css
git commit -m "Report how old the data is, and make re-reading one click

The app knows when it last read the folder and nothing about what has happened
since, so that is what it says. The age is always shown and the prompt only
raises its voice past an hour -- a ten-minute-old snapshot is not worth
interrupting anyone about, and a day-old one is.

A picker handle re-reads with no gesture; an upload snapshot needs the dialog
again. That difference is the entire gap between this tier and live updates."
```

---

### Task 10: Retire the Python's HTTP surface

**Files:**
- Delete: `aimcurve/server.py`, `aimcurve/watch.py`
- Delete: `tests/test_server.py`, `tests/test_watch.py`
- Delete: `scripts/drive-client.mjs`
- Modify: `aimcurve/__main__.py`, `README.md`

The Python stops being a tool and becomes the oracle. This is a deliberate deviation from the browser design, which wanted it kept live; the cost lands on people who have Python and will not modify their install, and it is accepted rather than mitigated.

Do this last, so that at every earlier commit there is still something that runs.

- [ ] **Step 1: Check nothing still imports them**

Run: `grep -rnE "^\s*(from|import)\b.*\b(server|watch)\b" aimcurve/ tests/ --include=*.py`

Expected, and nothing else — every one of these is a file this task deletes or rewrites:

```
aimcurve/__main__.py:6:from . import dump, paths, server
aimcurve/server.py:15:from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
aimcurve/server.py:17:from . import index, payload, watch
tests/test_server.py:14:from aimcurve import index, paths, payload, server  # noqa: E402
tests/test_watch.py:12:from aimcurve import index, paths, watch  # noqa: E402
```

If `dump.py` or `payload.py` appear, Task 1 of Plan A was not done as written — fix that before deleting.

Grep for imports, not for words. The unanchored `grep -rn "server\|watch"` matches **66 lines**, nearly all of it prose — including comments inside `dump.py`, the very file this step names as its tripwire. It reports a problem on a perfectly clean tree, which trains you to skip the step.

- [ ] **Step 2: Delete**

```bash
git rm -r aimcurve/server.py aimcurve/watch.py \
          tests/test_server.py tests/test_watch.py scripts/drive-client.mjs
```

`aimcurve/web/` is deliberately absent from that list: Task 7 moved its contents and Task 8 removed the last file, so the path is already gone. `git rm` validates every pathspec before it removes anything, so naming it here would abort the whole command with exit 128 and delete nothing at all.

- [ ] **Step 3: Reduce `__main__.py` to the oracle**

```python
"""python -m aimcurve dump --root DIR --out FILE

The dashboard is a web page now; see web/. What is left here is the reference
implementation the browser port is checked against.
"""

import sys

from . import dump


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv or argv[0] != "dump":
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        return 2
    return dump.main(argv[1:])


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the Python suite**

Run: `nix shell nixpkgs#python3 --command python3 -m unittest discover -s tests`
Expected: **OK, 79 tests** — down from 104, and that drop is correct, not a regression. `test_server.py` contributed 21 and `test_watch.py` 4. A checklist still carrying 104 will read the right outcome as a failure.

`test_paths.py`, `test_statscsv.py`, `test_perf.py`, `test_shapes.py`, `test_shapes_integration.py`, `test_compare.py`, `test_index.py` and `test_dump.py` remain.

- [ ] **Step 5: Run the oracle diff**

Run: `nix shell nixpkgs#python3 --command bash -c 'cd web && npm run oracle'`
Expected: 9 passed. Deleting the server must not move a single payload field.

- [ ] **Step 6: Rewrite the README**

It currently opens with `python -m aimcurve` as the product. Replace the installation and layout sections. The claims that must survive, because they are the reason anyone reads this: nothing to install, nothing leaves the machine, it never writes to the KovaaK's install, and it shows *where in the run* the difference happened. The claim that must go: "about a second after a run ends" — there are no live updates in this tier, and saying otherwise is the one lie the page could tell. (Task 7 Step 6 already removed the two strings that said it in `app.js`; this is the README half of the same fix.)

**Three passages outside "installation and layout" also go stale.** They are easy to miss because the step names only those two sections:

- **`README.md:19-25`**, the "Where this is going" blockquote. It says the browser rewrite is *being* written and "until it lands, the Python here is the product". It has landed; that is this task. Delete the blockquote or rewrite it in the past tense.
- **`README.md:83-100`**, the whole **Tests** subsection on `scripts/drive-client.mjs`. Step 2 deletes that file, so the instructions to run it — and the `python -m aimcurve` / `node scripts/drive-client.mjs` block — describe something that no longer exists. Delete the subsection.
- The oracle paragraph just above it stays, and is worth keeping verbatim: it is the only place that records *why* there is no tolerance.

New layout section:

```
web/                     the app: Astro, TypeScript, no server
  src/core/              parsers, comparison, payload building — pure, no storage
  src/db/                the IndexedDB index
  src/source/            where runs are read from
  src/ui/                the dashboard
  public/                served as-is, including vendor/ (uPlot)
  test/                  the TypeScript tests, and test/oracle/ the diff
aimcurve/                the frozen Python, kept as the oracle
tests/                   the Python's tests and the shared fixtures
references/kovaaks.md    on-disk format notes, verified against a real install
docs/                    design specs and implementation plans
```

And a short section explaining what the Python is now: the reference implementation, not a thing to run, reachable only as `python -m aimcurve dump`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Retire the Python's HTTP surface

The dashboard is a web page now. server.py, watch.py, the web assets and the
drive-client rig go with it; what remains is the reference implementation the
browser port is diffed against, reachable only as python -m aimcurve dump.

This is a deliberate deviation from the browser design, which wanted the Python
kept live for people who have it and will not modify their install. The cost
lands on exactly that group and is accepted rather than mitigated.

The README loses 'about a second after a run ends'. There are no live updates
in this tier, and that is the one claim the page must not make."
```

**REVIEW CHECKPOINT — stop here**, then run the integration pass below.

---

## Done when

Automated, on any machine:

- `cd web && npm test` passes.
- `cd web && npm run oracle` passes — the engine still agrees with the Python.
- `nix shell nixpkgs#python3 --command python3 -m unittest discover -s tests` passes.
- `cd web && npm run build` produces a `dist/` that can be served by any static host.

Integration, on a machine with KovaaK's installed — this is the real exit criterion and none of it can be done on the development machine:

- [ ] A first visit with an empty database: the picker panel reads correctly, the "nothing is uploaded" paragraph appears **before** the dialog, and a real folder indexes to completion with sane progress.
- [ ] The bootstrap's wall-clock time and the tab's peak memory are recorded and compared against the design's 22.3 s / 49 MB at 12k runs. **Report whatever it actually is** — the design says that number is a lower bound and asks to be corrected.
- [ ] A returning visit renders the dashboard before anything is asked for, with an honest age.
- [ ] Re-picking after playing a few runs indexes only the new ones.
- [ ] The rail, the run view, the session view and the scenario view all render, and a race scenario charts on the progress axis with its split table reconciling.
- [ ] Two tabs: the second says another tab is indexing and does not corrupt the aggregates.
- [ ] Firefox and Safari at least load and index through the upload control. The browser design flags that neither has ever been tried, despite cross-browser reach being half of this tier's case.
- [ ] **The full-corpus oracle diff**: run `python -m aimcurve dump --root <real install> --out full.json` and diff it against the same corpus indexed in the browser. This is the browser design's stated exit criterion, and it is the only thing that settles the `cfg_key` banker's-rounding question, non-ASCII scenario names, and malformed CSVs. Extending `web/test/oracle/` to read a dump from a path rather than shelling out is a small job; do it on the machine that has the data.

## What this plan deliberately does not build

Live updates. The `subscribe` hook exists on the source interface and is unimplemented. Step two —
`docs/superpowers/specs/2026-09-13-aimcurve-live-updates-design.md` — is wiring on top of the incremental path this plan already ships, and it is ready to implement whenever the answer to "does anyone actually want it" comes back yes.
