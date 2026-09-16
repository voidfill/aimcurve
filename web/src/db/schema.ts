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
/** Scenarios written but not yet classified.
 *
 * The run rows and the `indexed` set commit in one transaction, and the
 * classify phase runs after it -- a whole bootstrap's worth of work later. A
 * tab closed in between used to leave the runs marked known with no scenario
 * record and no marks, and nothing re-triggered it, because `pendingIds` is a
 * set difference against `indexed`. This set is written in that same
 * transaction and cleared only once classification has finished, so the next
 * pass drains whatever was left. */
export const META_PENDING_SCENARIOS = 'pending_scenarios';
/** The directory handle the index was built from, so a reload does not downgrade
 *  a picker user to re-enumerating their whole install. Handles survive
 *  structured clone, which is why they can live here at all. Task 9 uses both. */
export const META_HANDLE = 'handle';
/** The name of that folder, so picking a *different* install is noticed rather
 *  than silently merged into the same rail for ever. */
export const META_ROOT_NAME = 'root_name';
