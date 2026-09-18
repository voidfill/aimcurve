import type { PGlite } from '@electric-sql/pglite';
import type { Migration } from './migrations';

/**
 * Applies pending migrations, tracking what ran in `_migrations`.
 * The browser database persists in IndexedDB, so this has to be idempotent.
 */
export async function applyMigrations(pg: PGlite, migrations: Migration[]): Promise<void> {
	await pg.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			name text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		);
	`);

	const applied = await pg.query<{ name: string }>('SELECT name FROM _migrations');
	const seen = new Set(applied.rows.map((row) => row.name));

	for (const migration of migrations) {
		if (seen.has(migration.name)) continue;
		await pg.exec(migration.sql);
		await pg.query('INSERT INTO _migrations (name) VALUES ($1)', [migration.name]);
	}
}
