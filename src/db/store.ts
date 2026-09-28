/**
 * Where PGlite keeps the database, and the close handshake the reset needs.
 *
 * Its own module because `worker.ts` is the only other place that names these,
 * and importing *that* from the main thread would pull PGlite and its wasm
 * into the main bundle. A wipe that misses because two strings drifted apart
 * is the failure this exists to prevent.
 */

/** PGlite's `idb://` data directory. */
export const DATA_DIR = 'aimcurve';

/**
 * The IndexedDB database behind `idb://aimcurve`. PGlite mounts Emscripten's
 * IDBFS at `/pglite/<dataDir>`, and IDBFS names the database after its mount
 * point.
 */
export const PG_IDB_NAME = `/pglite/${DATA_DIR}`;

/**
 * The OPFS directory the database used to live in, as a PGlite access-handle
 * pool. Firefox opens every one of the pool's ~2,000 sync access handles at
 * startup, which took 17 s on a real history, so the database moved to
 * IndexedDB and the old directory is only ever deleted. Nothing is carried
 * over: the user re-imports from their KovaaK's folder.
 */
const LEGACY_OPFS_DIR = 'aimcurve';

/** A missing directory is the state we are trying to reach, not a failure. */
export async function removeLegacyOpfs(): Promise<void> {
	try {
		await (await navigator.storage.getDirectory()).removeEntry(LEGACY_OPFS_DIR, { recursive: true });
	} catch (err) {
		if (err instanceof DOMException && err.name === 'NotFoundError') return;
		throw err;
	}
}

/**
 * Asks the database worker to close PGlite, which flushes the writes
 * `relaxedDurability` left pending and closes its IndexedDB connection before
 * the worker answers. `deleteDatabase` is blocked for as long as that
 * connection is open, and `worker.terminate()` closes it only some time later.
 */
export const CLOSE_REQUEST = 'aimcurve:close';

/** The worker's answer: whether this worker held the database. */
export interface CloseReply {
	type: 'aimcurve:closed';
	held: boolean;
}
