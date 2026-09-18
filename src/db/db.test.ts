import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '../../test/helpers/db';
import { applyMigrations } from './migrate';
import { migrations } from './migrations';
import { notes } from './schema';

let db: TestDb['db'];
let pg: PGlite;

beforeEach(async () => {
	({ db, pg } = await makeTestDb());
});

describe('migrations', () => {
	it('finds the generated migration files', () => {
		expect(migrations.length).toBeGreaterThan(0);
		expect(migrations[0]!.name).toMatch(/^0000_.*\.sql$/);
	});

	it('is idempotent', async () => {
		await applyMigrations(pg, migrations);
		const applied = await pg.query<{ name: string }>('SELECT name FROM _migrations');
		expect(applied.rows).toHaveLength(migrations.length);
	});
});

describe('notes', () => {
	it('round-trips a row', async () => {
		const [inserted] = await db.insert(notes).values({ body: 'hello' }).returning();
		expect(inserted).toMatchObject({ id: 1, body: 'hello' });
		expect(inserted!.createdAt).toBeInstanceOf(Date);

		const rows = await db.select().from(notes);
		expect(rows).toEqual([inserted]);
	});

	it('exposes the relational query builder', async () => {
		await db.insert(notes).values([{ body: 'a' }, { body: 'b' }]);
		const all = await db.query.notes.findMany();
		expect(all.map((row) => row.body)).toEqual(['a', 'b']);
	});
});
