import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, type Migration } from './migrate';

let pg: PGlite;

const one: Migration = { name: '0001_a.sql', sql: 'create table a (id int primary key);' };
const two: Migration = { name: '0002_b.sql', sql: 'create table b (id int primary key);' };

/** Table names in the public schema, for asserting what survived a reset. */
async function tables(): Promise<string[]> {
	const r = await pg.query<{ table_name: string }>(
		`select table_name from information_schema.tables
		 where table_schema = 'public' order by table_name`,
	);
	return r.rows.map((row) => row.table_name);
}

beforeEach(() => {
	pg = new PGlite();
});

describe('applyMigrations', () => {
	it('applies pending migrations in order and records them', async () => {
		const result = await applyMigrations(pg, [one, two]);
		expect(result).toMatchObject({
			reset: false,
			reason: null,
			applied: ['0001_a.sql', '0002_b.sql'],
		});
		expect(await tables()).toEqual(['_migrations', 'a', 'b']);
	});

	it('is idempotent', async () => {
		await applyMigrations(pg, [one, two]);
		const again = await applyMigrations(pg, [one, two]);
		expect(again).toMatchObject({ reset: false, applied: [] });
	});

	it('applies a newly added migration without resetting', async () => {
		await applyMigrations(pg, [one]);
		await pg.exec('insert into a values (1)');
		const result = await applyMigrations(pg, [one, two]);
		expect(result).toMatchObject({ reset: false, applied: ['0002_b.sql'] });
		// Rows survive: adding an index or a view must not cost a reingest.
		const rows = await pg.query('select id from a');
		expect(rows.rows).toEqual([{ id: 1 }]);
	});

	it('resets when a pending migration declares itself destructive (rule 1)', async () => {
		await applyMigrations(pg, [one]);
		await pg.exec('insert into a values (1)');
		const destructive: Migration = {
			name: '0002_b.sql',
			sql: '-- reset: adds a column nothing can backfill\ncreate table b (id int primary key);',
		};
		const result = await applyMigrations(pg, [one, destructive]);
		expect(result.reset).toBe(true);
		expect(result.reason).toContain('0002_b.sql');
		expect(result.applied).toEqual(['0001_a.sql', '0002_b.sql']);
		const rows = await pg.query('select id from a');
		expect(rows.rows).toEqual([]);
	});

	it('resets when an applied migration was edited (rule 2)', async () => {
		await applyMigrations(pg, [one]);
		const edited: Migration = {
			name: '0001_a.sql',
			sql: 'create table a (id int primary key, note text);',
		};
		const result = await applyMigrations(pg, [edited]);
		expect(result.reset).toBe(true);
		expect(result.reason).toContain('0001_a.sql');
		const cols = await pg.query(
			`select column_name from information_schema.columns
			 where table_name = 'a' order by column_name`,
		);
		expect(cols.rows).toEqual([{ column_name: 'id' }, { column_name: 'note' }]);
	});

	it('ignores line-ending and trailing-whitespace differences when hashing', async () => {
		await applyMigrations(pg, [one]);
		const crlf: Migration = { name: '0001_a.sql', sql: `${one.sql.replace(/\n/g, '\r\n')}\n\n` };
		const result = await applyMigrations(pg, [crlf]);
		expect(result).toMatchObject({ reset: false, applied: [] });
	});

	it('resets when an applied migration has disappeared (rule 3)', async () => {
		await applyMigrations(pg, [one, two]);
		const result = await applyMigrations(pg, [two]);
		expect(result.reset).toBe(true);
		expect(await tables()).toEqual(['_migrations', 'b']);
	});

	it('resets when migrations were reordered by a branch merge (rule 4)', async () => {
		await applyMigrations(pg, [two]);
		const result = await applyMigrations(pg, [one, two]);
		expect(result.reset).toBe(true);
		expect(result.applied).toEqual(['0001_a.sql', '0002_b.sql']);
	});

	it('resets a database whose bookkeeping predates hash tracking (rule 5)', async () => {
		await pg.exec(`
			create table _migrations (
				name text primary key,
				applied_at timestamptz not null default now()
			);
			insert into _migrations (name) values ('0001_a.sql');
			create table stale (id int);
		`);
		const result = await applyMigrations(pg, [one]);
		expect(result.reset).toBe(true);
		expect(result.applied).toEqual(['0001_a.sql']);
		expect(await tables()).toEqual(['_migrations', 'a']);
	});

	it('drops enum types too, so a replay does not collide', async () => {
		const withEnum: Migration = { name: '0001_a.sql', sql: "create type colour as enum ('red');" };
		await applyMigrations(pg, [withEnum]);
		const edited: Migration = {
			name: '0001_a.sql',
			sql: "create type colour as enum ('red', 'blue');",
		};
		const result = await applyMigrations(pg, [edited]);
		expect(result.reset).toBe(true);
		const labels = await pg.query<{ enumlabel: string }>(
			'select enumlabel from pg_enum order by enumsortorder',
		);
		expect(labels.rows.map((row) => row.enumlabel)).toEqual(['red', 'blue']);
	});

	it('records nothing when the DDL fails, so the next run retries cleanly', async () => {
		const broken: Migration = {
			name: '0001_a.sql',
			sql: 'create table a (id int); create table a (id int);',
		};
		await expect(applyMigrations(pg, [broken])).rejects.toThrow();
		const recorded = await pg.query('select name from _migrations');
		expect(recorded.rows).toEqual([]);
		// The failed DDL rolled back with its bookkeeping, so a fixed file applies normally.
		const fixed: Migration = { name: '0001_a.sql', sql: 'create table a (id int);' };
		await expect(applyMigrations(pg, [fixed])).resolves.toMatchObject({
			applied: ['0001_a.sql'],
		});
	});
});
