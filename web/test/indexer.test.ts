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
