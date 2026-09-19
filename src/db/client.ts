import type { PGlite } from '@electric-sql/pglite';
import { live } from '@electric-sql/pglite/live';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { drizzle } from 'drizzle-orm/pglite';
import { applyMigrations } from './migrate';
import { migrations } from './migrations';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Promise<Db> | undefined;

/** Browser-only: PGlite in a worker, backed by IndexedDB, migrated on first use. */
export function getDb(): Promise<Db> {
	db ??= (async () => {
		const pg = await PGliteWorker.create(
			new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
			{ extensions: { live } },
		);
		await applyMigrations(pg, migrations);
		// PGliteWorker implements PGliteInterface but does not extend PGlite,
		// which is the concrete class drizzle's pglite driver is typed against.
		return drizzle(pg as unknown as PGlite, { schema });
	})();
	return db;
}
