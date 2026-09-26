import type { PGliteInterface } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { applyMigrations, type MigrateResult } from './migrate';
import { migrations } from './migrations';
import { CLOSE_REQUEST, type CloseReply } from './opfs';

interface Handles {
	pg: PGliteInterface;
	worker: Worker;
}

let handles: Promise<Handles> | undefined;
// The result of the migration run that produced `handles`. Populated
// alongside it, so callers can learn whether a reset happened without
// re-running migrations.
let lastMigration: MigrateResult | undefined;

/**
 * Browser-only: one PGlite worker, backed by OPFS, migrated on first use.
 * Every `getPg()` awaits this single initialization so the app never opens a
 * second connection to the same database.
 */
function init(): Promise<Handles> {
	handles ??= (async () => {
		let pg: PGliteInterface | undefined;
		try {
			const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
			pg = await PGliteWorker.create(worker, { extensions: { live } });
			lastMigration = await applyMigrations(pg, migrations);
			return { pg, worker };
		} catch (err) {
			// Worker construction, wasm loading, and IndexedDB access can all
			// fail transiently (private browsing, blocked site data, a full
			// storage quota). Without clearing the cache, that first failure
			// would be replayed forever with no way to recover short of a
			// page reload.
			handles = undefined;
			if (pg && typeof pg.close === 'function') await pg.close().catch(() => {});
			throw err;
		}
	})();
	return handles;
}

/** The shared PGlite connection. */
export function getPg(): Promise<PGliteInterface> {
	return init().then((h) => h.pg);
}

/**
 * The most recent migration result, once `getPg()` has resolved. The ingest
 * layer needs this: a reset means its previously-imported data is gone, and
 * this is the only signal that tells it so.
 */
export function getLastMigration(): MigrateResult | undefined {
	return lastMigration;
}

/** How long the worker gets to close PGlite before it is terminated regardless. */
const CLOSE_TIMEOUT_MS = 5000;

/**
 * Asks the worker to close PGlite and waits for it. Resolves with whether this
 * tab's worker held the database; rejects on a timeout.
 */
function closeInWorker(worker: Worker): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			worker.removeEventListener('message', onMessage);
			reject(new Error('the database worker did not close in time'));
		}, CLOSE_TIMEOUT_MS);
		function onMessage(event: MessageEvent<Partial<CloseReply>>): void {
			if (event.data?.type !== 'aimcurve:closed') return;
			clearTimeout(timer);
			worker.removeEventListener('message', onMessage);
			resolve(event.data.held === true);
		}
		worker.addEventListener('message', onMessage);
		worker.postMessage({ type: CLOSE_REQUEST });
	});
}

/**
 * Closes the connection and drops the cache, so the next `getPg()` starts a
 * fresh worker.
 *
 * Only the dev reset calls this. The pool holds sync access handles on roughly
 * two thousand OPFS files, and removing that directory underneath a live pool
 * leaves a half-deleted data directory that the next start cannot resume from.
 * The cache is cleared before the close is awaited: a close that hangs must
 * not leave a handle behind that callers can still reach.
 *
 * Rejects when the handles may still be held: the worker did not answer in
 * time, or another tab's worker is the one holding the database.
 */
export async function closePg(): Promise<void> {
	const pending = handles;
	handles = undefined;
	lastMigration = undefined;
	if (pending === undefined) return;
	// A cached initialization that already failed has nothing to close, and its
	// rejection is not this caller's to report.
	const settled = await pending.catch(() => undefined);
	if (settled === undefined) return;
	// PGlite is closed inside the worker first: `pg.close()` only terminates
	// the worker, and the browser releases the pool's handles some time after.
	let held: boolean;
	try {
		held = await closeInWorker(settled.worker);
	} finally {
		await settled.pg.close().catch(() => {});
	}
	if (!held) throw new Error('another aimcurve tab has the database open; close it and try again');
}
