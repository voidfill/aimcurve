import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStore } from '../src/db/idbstore';
import { indexInto } from '../src/db/indexer';
import { META_READ_AT, openDatabase, req } from '../src/db/schema';
import { pickerSource } from '../src/source/picker';
import { readPerf, readStats } from './fixtures';

vi.mock('../src/ui/app.js', () => ({ start: async () => {}, setSnapshotAge() {} }));
vi.mock('../src/db/writer', () => ({
  electWriter: async () => ({ elected: true, subscribe() {}, release() {} }),
}));

const AIR = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const SPECTRAL = 'Air Spectral Easy - Challenge - 2026.09.05-08.20.43';
let db: IDBDatabase;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  globalThis.indexedDB = new IDBFactory();
  db = await openDatabase();
  const classes = new Set(['picking']);
  const nodes = new Map<string, object>();
  vi.stubGlobal('document', {
    body: { classList: {
      add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    } },
    getElementById(id: string) {
      if (!nodes.has(id)) nodes.set(id, Object.assign(new EventTarget(), { dataset: {} }));
      return nodes.get(id);
    },
  });
  vi.stubGlobal('navigator', { storage: { persist: async () => false } });
});

afterEach(() => {
  db.close();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('manual refresh repairs an incomplete CSV and discovers a performance directory created later', async () => {
  let stats = '';
  let perfReady = false;
  const statsDir = {
    async *keys() { yield `${AIR} Stats.csv`; },
    async getFileHandle() { return { getFile: async () => ({ text: async () => stats }) }; },
  };
  const perfDir = {
    async getFileHandle() {
      return { getFile: async () => ({ arrayBuffer: async () => readPerf(AIR)! }) };
    },
  };
  const root = {
    name: 'Game',
    async getDirectoryHandle(name: string) {
      if (name === 'stats') return statsDir;
      if (perfReady) return perfDir;
      throw new DOMException('missing', 'NotFoundError');
    },
  } as unknown as FileSystemDirectoryHandle;
  const source = await pickerSource(root);
  const { indexFrom } = await import('../src/boot');
  await indexFrom(db, source);
  expect(await createStore(db).counts()).toMatchObject({ runs: 0, failed: 1 });
  stats = readStats(AIR);
  await indexFrom(db, source);
  expect(await createStore(db).counts()).toMatchObject({ runs: 1, curves: 0, failed: 0 });
  perfReady = true;
  await indexFrom(db, source);
  expect(await createStore(db).counts()).toMatchObject({ runs: 1, curves: 1, failed: 0 });
});

it('boot drains a real committed classification journal without changing source age', async () => {
  const ids = [AIR, SPECTRAL];
  await expect(indexInto(db, {
    kind: 'upload', rootName: 'Game', pickedAt: Date.now(),
    async list() { return ids; }, async read(id) { return { stats: readStats(id), perf: readPerf(id) }; },
  }, ids, (progress) => {
    if (progress.phase === 'classifying') throw new Error('interrupted');
  })).rejects.toThrow('interrupted');
  const age = await req(db.transaction('meta').objectStore('meta').get(META_READ_AT));
  expect(await createStore(db).counts()).toMatchObject({ runs: 2, scenarios: 1 });
  const { main } = await import('../src/boot');
  await main();
  expect(await createStore(db).counts()).toMatchObject({ runs: 2, scenarios: 2 });
  expect(await req(db.transaction('meta').objectStore('meta').get(META_READ_AT))).toEqual(age);
});
