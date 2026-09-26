import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../../src/db/migrate';
import { migrations } from '../../src/db/migrations';

export interface TestDb {
	/** A fresh PGlite instance with every migration applied. */
	pg: PGlite;
}

/** A fresh in-memory database with all migrations applied. */
export async function makeTestDb(): Promise<TestDb> {
	const pg = new PGlite();
	await applyMigrations(pg, migrations);
	return { pg };
}
