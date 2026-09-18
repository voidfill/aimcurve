import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { applyMigrations } from './migrate';
import { migrations } from './migrations';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Promise<Db> | undefined;

/** Browser-only: PGlite backed by IndexedDB, migrated on first use. */
export function getDb(): Promise<Db> {
	db ??= (async () => {
		const pg = await PGlite.create('idb://aimcurve');
		await applyMigrations(pg, migrations);
		return drizzle(pg, { schema });
	})();
	return db;
}
