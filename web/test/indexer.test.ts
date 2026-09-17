import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createStore } from '../src/db/idbstore';
import * as indexer from '../src/db/indexer';
import { indexInto, pendingIds } from '../src/db/indexer';
import { META_PENDING_SCENARIOS, openDatabase } from '../src/db/schema';
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
    rootName: 'FPSAimTrainer',
    pickedAt: Date.now(),
    async list() { return ids; },
    async read(id: string) {
      return { stats: readStats(id), perf: readPerf(id) };
    },
  };
}

/** A `.perf` whose one sample carries an absurd timestamp -- what a flipped
 *  exponent byte in the float32 produces. It is valid protobuf, so `parsePerf`
 *  gets all the way to `new Float32Array(buckets)` and throws a RangeError
 *  rather than a PerfError, which `ingest` re-throws instead of recording. */
function absurdPerf(): Uint8Array {
  const timestamp = new Uint8Array(4);
  new DataView(timestamp.buffer).setFloat32(0, 1e38, true);
  // field 2 (sample) { field 1 = the timestamp, field 7 (score) { 1: 5 } }
  return new Uint8Array([0x12, 0x09, 0x0d, ...timestamp, 0x3a, 0x02, 0x08, 0x05]);
}

let db: IDBDatabase;

/** The `failed` row for a basename, or undefined. */
function failureRow(id: string): Promise<any> {
  return new Promise((resolve) => {
    const r = db.transaction('failed').objectStore('failed').get(id);
    r.onsuccess = () => resolve(r.result);
  });
}

/** The scenarios still awaiting classification. */
function pendingScenarioRow(): Promise<any> {
  return new Promise((resolve) => {
    const r = db.transaction('meta').objectStore('meta').get(META_PENDING_SCENARIOS);
    r.onsuccess = () => resolve(r.result);
  });
}

beforeEach(async () => {
  // A fresh factory per test: fake-indexeddb is global state otherwise.
  globalThis.indexedDB = new IDBFactory();
  db = await openDatabase(globalThis.indexedDB);
});

describe('indexInto', () => {
  it('serializes overlapping passes before reading metadata, including classification', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const source = fixtureSource([AIR_A, AIR_B]);
    const first = indexInto(db, { ...source, async read(id) {
      entered(); await gate; return source.read(id);
    } }, [AIR_A]);
    await started;
    const second = indexInto(db, source, [AIR_B]);
    release();
    await Promise.all([first, second]);
    expect(await pendingIds(db, source)).toEqual([]);
    expect(await createStore(db).page(1, { sameCfg: true })).toMatchObject([
      { id: AIR_B, played_before: 1 },
    ]);
    expect((await pendingScenarioRow()).value).toEqual([]);
  });

  it.each(['', 'Score:,123\nScenario:,Air Pure Medium\n'])('keeps an incomplete CSV retryable: %j', async (stats) => {
    const broken = { ...fixtureSource([AIR_A]), async read() { return { stats }; } };
    expect(await indexInto(db, broken, [AIR_A])).toMatchObject({ runs: 0, failed: 1 });
    expect(await pendingIds(db, broken)).toEqual([AIR_A]);
    await indexInto(db, fixtureSource([AIR_A]), [AIR_A]);
    expect((await createStore(db).getRun(AIR_A))!.score).toBe(906.138184);
  });

  it.each(['read', 'perf'])('stops after five failed %s attempts, with no sixth read', async (kind) => {
    let reads = 0;
    const source = { ...fixtureSource([AIR_A]), async read() {
      reads++;
      if (kind === 'read') throw new Error('locked');
      return { stats: readStats(AIR_A), perf: new Uint8Array([0x0a, 0x40, 0x01]) };
    } };
    for (let i = 0; i < 7; i++) await indexInto(db, source, [AIR_A]);
    expect(reads).toBe(5);
    expect((await failureRow(AIR_A)).tries).toBe(5);
  });

  it('manual refresh upgrades curveless runs and retries exhausted failures', async () => {
    const noPerf = { ...fixtureSource([AIR_A]), async read() { return { stats: readStats(AIR_A) }; } };
    await indexInto(db, noPerf, [AIR_A]);
    const broken = { ...fixtureSource([AIR_B]), async read() { throw new Error('locked'); } };
    for (let i = 0; i < 6; i++) await indexInto(db, broken, [AIR_B]);
    await indexInto(db, fixtureSource([AIR_A, AIR_B]), [AIR_A, AIR_B], undefined,
      { refreshIncomplete: true });
    expect(await createStore(db).counts()).toMatchObject({ runs: 2, curves: 2, failed: 0 });
  });

  it('recovers the classification journal without a source or a new read timestamp', async () => {
    await expect(indexInto(db, fixtureSource([AIR_A, SPECTRAL_A]), [AIR_A, SPECTRAL_A], (p) => {
      if (p.phase === 'classifying') throw new Error('interrupted');
    })).rejects.toThrow('interrupted');
    expect(indexer.recoverClassification).toBeTypeOf('function');
    await indexer.recoverClassification(db);
    expect(await createStore(db).counts()).toMatchObject({ runs: 2, scenarios: 2 });
    expect((await pendingScenarioRow()).value).toEqual([]);
  });
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

  it('keeps the run when a corrupt .perf throws past PerfError', async () => {
    // A bit-flip that `parsePerf` did not anticipate comes out as a RangeError,
    // which `ingest` re-throws. Swallowing that as "the stats file could not be
    // read" threw the run away even though its CSV parsed perfectly -- and past
    // MAX_TRIES the basename is marked known, so repairing the file could never
    // bring the run back. Only deleting the database recovered it.
    const corrupt: RunSource = {
      ...fixtureSource([AIR_A]),
      async read() { return { stats: readStats(AIR_A), perf: absurdPerf() }; },
    };

    const first = await indexInto(db, corrupt, [AIR_A]);
    expect(first).toMatchObject({ runs: 1, curves: 0, failed: 1, skipped: 0 });
    expect((await createStore(db).getRun(AIR_A))!.has_perf).toBe(false);
    expect((await failureRow(AIR_A)).tries).toBe(1);
    expect((await failureRow(AIR_A)).last_error).toContain('typed array length');
    // Not marked known, so the next pass re-reads it.
    expect(await pendingIds(db, corrupt)).toEqual([AIR_A]);

    const second = await indexInto(db, corrupt, [AIR_A]);
    expect(second).toMatchObject({ runs: 1, curves: 0, failed: 1, skipped: 0 });
    expect((await failureRow(AIR_A)).tries).toBe(2);

    // And the repaired file recovers: the curve lands and the failed row goes.
    const fixed = await indexInto(db, fixtureSource([AIR_A]), [AIR_A]);
    expect(fixed).toMatchObject({ runs: 1, curves: 1, failed: 0, skipped: 0 });
    expect(await failureRow(AIR_A)).toBeUndefined();
    expect((await createStore(db).getRun(AIR_A))!.has_perf).toBe(true);
  });

  it('is only unreadable when the stats file itself will not parse', async () => {
    // The distinction the case above rests on: a throw from the CSV is still
    // genuinely unreadable, so no run is written and nothing is counted.
    const noCsv: RunSource = {
      ...fixtureSource([AIR_A]),
      async read() { throw new Error('NotFoundError'); },
    };
    const result = await indexInto(db, noCsv, [AIR_A]);
    expect(result).toMatchObject({ runs: 0, curves: 0, failed: 1 });
    expect(await createStore(db).getRun(AIR_A)).toBeUndefined();
  });

  it('repairs a classification interrupted after the runs were committed', async () => {
    // The run rows and the `indexed` set commit before the classify phase runs.
    // A tab closed in between left the runs marked known with no scenario
    // record and no marks, and nothing ever re-triggered it: pendingIds is a
    // set difference against `indexed`, so every later refresh said "skipped".
    const ids = [AIR_A, SPECTRAL_A];
    const source = fixtureSource(ids);
    await expect(indexInto(db, source, ids, (p) => {
      if (p.phase === 'classifying') throw new Error('tab closed');
    })).rejects.toThrow('tab closed');

    const store = createStore(db);
    // Both runs are in, and exactly one of the two scenarios was classified.
    expect(await store.counts()).toMatchObject({ runs: 2, scenarios: 1 });
    expect(await pendingIds(db, source)).toEqual([]);

    // A plain refresh with nothing new to read must still finish the job.
    const again = await indexInto(db, source, ids);
    expect(again).toMatchObject({ runs: 0, skipped: 2 });
    expect(await store.counts()).toMatchObject({ runs: 2, scenarios: 2 });
    expect((await store.getScenario('Air Pure Medium'))!.shape).toBe('race');
    expect((await store.getScenario('Air Spectral Easy'))!.shape).toBe('timed');
    // Drained, so the next refresh does not reclassify the world again.
    expect((await pendingScenarioRow()).value).toEqual([]);
  });

  it('counts a basename repeated in one batch once', async () => {
    // memstore drops a repeated id whole (core/memstore.ts:31-35) because
    // `run.stats_file` is UNIQUE and the index inserts OR IGNORE. The indexer
    // used to write it twice and count it twice, so the totals disagreed with
    // the rows.
    const result = await indexInto(db, fixtureSource([AIR_A]), [AIR_A, AIR_A]);
    expect(result).toEqual({ runs: 1, curves: 1, failed: 0, skipped: 0 });
    expect(await createStore(db).counts()).toMatchObject({ runs: 1, curves: 1 });
  });

  it('reports progress as it goes', async () => {
    const seen: string[] = [];
    await indexInto(db, fixtureSource(statsIds()), statsIds(),
      (p) => { if (!seen.includes(p.phase)) seen.push(p.phase); });
    expect(seen).toEqual(['reading', 'writing', 'classifying']);
  });
});
