/** The IndexedDB Store answering the same questions as the in-memory one.
 *
 * The whole architecture rests on `idbstore` being a drop-in for `memstore`:
 * the payload builder is written once against the interface and neither
 * implementation gets to have its own opinion about an argument.
 */

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import type { Store } from '../src/core/store';
import { createStore } from '../src/db/idbstore';
import { indexInto } from '../src/db/indexer';
import { openDatabase } from '../src/db/schema';
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
