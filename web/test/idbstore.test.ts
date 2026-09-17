/** The IndexedDB Store answering the same questions as the in-memory one.
 *
 * The whole architecture rests on `idbstore` being a drop-in for `memstore`:
 * the payload builder is written once against the interface and neither
 * implementation gets to have its own opinion about an argument.
 */

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import type { Store } from '../src/core/store';
import { createStore } from '../src/db/idbstore';
import { indexInto, recoverClassification } from '../src/db/indexer';
import { done, openDatabase, req } from '../src/db/schema';
import type { RunSource } from '../src/source/types';
import { readPerf, readStats, statsIds } from './fixtures';

let db: IDBDatabase;
let idb: Store;
let mem: Store;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  db = await openDatabase(globalThis.indexedDB);
  const ids = statsIds();
  const source: RunSource = {
    kind: 'upload',
    rootName: 'FPSAimTrainer',
    pickedAt: Date.now(),
    async list() { return ids; },
    async read(id: string) { return { stats: readStats(id), perf: readPerf(id) }; },
  };
  await indexInto(db, source, ids);
  idb = createStore(db);
  mem = buildStore(ids.map((id) => ingest(id, readStats(id), readPerf(id))));
});

describe('page', () => {
  it('reads a negative limit as no limit, the way memstore does', async () => {
    // SQLite reads a negative LIMIT as no limit at all -- core/memstore.ts:141
    // carries the same note. The cursor's stop condition was `out.length >=
    // limit`, which is already true at `0 >= -1`, so the walk ended on the
    // first row and page(-1) answered [] against memstore's every row.
    const rows = await idb.page(-1, { sameCfg: true });
    expect(rows).toHaveLength(statsIds().length);
    expect(rows).toEqual(await mem.page(-1, { sameCfg: true }));
  });

  it('agrees with memstore on a positive limit', async () => {
    expect(await idb.page(3, { sameCfg: true }))
      .toEqual(await mem.page(3, { sameCfg: true }));
  });
});

describe('maintained scenario summaries', () => {
  it('repairs pre-aggregate cache records under writer recovery without exposing storage fields', async () => {
    const name = 'Air Pure Medium';
    const legacy = await mem.getScenario(name);
    const tx = db.transaction('scenarios', 'readwrite');
    tx.objectStore('scenarios').put(legacy);
    await done(tx);
    await recoverClassification(db);
    const stored = await req<any>(db.transaction('scenarios').objectStore('scenarios').get(name));
    expect(stored.summary).toMatchObject({ scenario: name, runs: 2 });
    expect(await idb.getScenario(name)).toEqual(legacy);
  });
  it('answers the scenario list without opening the run store', async () => {
    const expected = await mem.scenarioList();
    const transaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<IDBDatabase['transaction']>) => {
      const stores = typeof args[0] === 'string' ? [args[0]] : Array.from(args[0]);
      if (stores.includes('runs')) throw new Error('scenario list scanned runs');
      return transaction(...args);
    });
    try { expect(await idb.scenarioList()).toEqual(expected); }
    finally { spy.mockRestore(); }
  });

  it('updates summaries on an out-of-order insert and shape change', async () => {
    globalThis.indexedDB = new IDBFactory();
    const fresh = await openDatabase();
    const a = 'Air Spectral Easy - Challenge - 2026.09.05-08.20.43';
    const b = 'Air Spectral Easy - Challenge - 2026.09.11-18.37.39';
    const source: RunSource = {
      kind: 'upload', rootName: 'Game', pickedAt: Date.now(),
      async list() { return [a, b]; }, async read(id) { return { stats: readStats(id) }; },
    };
    await indexInto(fresh, source, [b]);
    expect(await createStore(fresh).scenarioList()).toMatchObject([{ runs: 1, shape: 'timed' }]);
    await indexInto(fresh, source, [a]);
    const reference = buildStore([ingest(a, readStats(a)), ingest(b, readStats(b))]);
    expect(await createStore(fresh).scenarioList()).toEqual(await reference.scenarioList());
  });
});
