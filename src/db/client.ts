import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { drizzle } from 'drizzle-orm/pglite';
import { applyMigrations, type MigrateResult } from './migrate';
import { migrations } from './migrations';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

interface Handles {
	pg: PGliteInterface;
	db: Db;
}

let handles: Promise<Handles> | undefined;
// The result of the migration run that produced `handles`. Populated
// alongside it, so callers can learn whether a reset happened without
// re-running migrations.
let lastMigration: MigrateResult | undefined;

/**
 * Browser-only: one PGlite worker, backed by OPFS, migrated on first use.
 * `getDb()` and `getPg()` both await this single initialization so the app
 * never opens a second connection to the same opfs-ahp:// database.
 */
function init(): Promise<Handles> {
	handles ??= (async () => {
		let pg: PGliteInterface | undefined;
		try {
			pg = await PGliteWorker.create(
				new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
				{ extensions: { live } },
			);
			lastMigration = await applyMigrations(pg, migrations);
			// PGliteWorker implements PGliteInterface but does not extend PGlite,
			// which is the concrete class drizzle's pglite driver is typed against.
			const db = drizzle(pg as unknown as PGlite, { schema });
			return { pg, db };
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

/** The Drizzle wrapper over the shared PGlite connection. */
export function getDb(): Promise<Db> {
	return init().then((h) => h.db);
}

/** The raw PGlite interface behind `getDb()`, for hand-written SQL. */
export function getPg(): Promise<PGliteInterface> {
	return init().then((h) => h.pg);
}

/**
 * The most recent migration result, once `getDb()` has resolved. The ingest
 * layer needs this: a reset means its previously-imported data is gone, and
 * this is the only signal that tells it so.
 */
export function getLastMigration(): MigrateResult | undefined {
	return lastMigration;
}

/**
 * Closes the connection and drops the cache, so the next `getDb()` starts a
 * fresh worker.
 *
 * Only the dev reset calls this. The pool holds sync access handles on roughly
 * a thousand OPFS files, and removing that directory underneath a live pool
 * leaves a half-deleted data directory that the next start cannot resume from.
 * The cache is cleared before the close is awaited: a close that hangs must
 * not leave a handle behind that callers can still reach.
 */
export async function closePg(): Promise<void> {
	const pending = handles;
	handles = undefined;
	lastMigration = undefined;
	if (pending === undefined) return;
	// A cached initialization that already failed has nothing to close, and its
	// rejection is not this caller's to report.
	const settled = await pending.catch(() => undefined);
	if (settled !== undefined) await settled.pg.close().catch(() => {});
}
