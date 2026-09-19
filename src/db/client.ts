import type { PGlite } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { drizzle } from 'drizzle-orm/pglite';
import { applyMigrations, type MigrateResult } from './migrate';
import { migrations } from './migrations';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Promise<Db> | undefined;
// The result of the migration run that produced `db`. Populated alongside it,
// so callers can learn whether a reset happened without re-running migrations.
let lastMigration: MigrateResult | undefined;

/** Browser-only: PGlite in a worker, backed by IndexedDB, migrated on first use. */
export function getDb(): Promise<Db> {
	db ??= (async () => {
		try {
			const pg = await PGliteWorker.create(
				new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
				{ extensions: { live } },
			);
			lastMigration = await applyMigrations(pg, migrations);
			// PGliteWorker implements PGliteInterface but does not extend PGlite,
			// which is the concrete class drizzle's pglite driver is typed against.
			return drizzle(pg as unknown as PGlite, { schema });
		} catch (err) {
			// Worker construction, wasm loading, and IndexedDB access can all
			// fail transiently (private browsing, blocked site data, a full
			// storage quota). Without clearing the cache, that first failure
			// would be replayed forever with no way to recover short of a
			// page reload.
			db = undefined;
			throw err;
		}
	})();
	return db;
}

/**
 * The most recent migration result, once `getDb()` has resolved. The ingest
 * layer needs this: a reset means its previously-imported data is gone, and
 * this is the only signal that tells it so.
 */
export function getLastMigration(): MigrateResult | undefined {
	return lastMigration;
}
