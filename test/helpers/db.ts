import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Db } from '../../src/db/client';
import { applyMigrations } from '../../src/db/migrate';
import { migrations } from '../../src/db/migrations';
import * as schema from '../../src/db/schema';

export interface TestDb {
	/** Migrated drizzle handle — the same type the browser gets from `getDb()`. */
	db: Db;
	/** The underlying PGlite instance, for raw SQL that drizzle does not cover. */
	pg: PGlite;
}

/** A fresh in-memory database with all migrations applied. */
export async function makeTestDb(): Promise<TestDb> {
	const pg = new PGlite();
	await applyMigrations(pg, migrations);
	return { db: drizzle(pg, { schema }), pg };
}
