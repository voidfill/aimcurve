import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { curated } from '../../../test/helpers/fixtures';
import { applyMigrations } from '../../db/migrate';
import { migrations } from '../../db/migrations';
import { applyChunk, type BatchResult } from './batch';
import { buildChunk } from './chunk';

function curatedFiles() {
	return [
		...curated.list('stats').map((name) => ({ name, bytes: curated.bytes('stats', name) })),
		...curated.list('performances').map((name) => ({ name, bytes: curated.bytes('performances', name) })),
	];
}

describe('applyChunk over the curated fixtures', () => {
	let pg: PGlite;
	let result: BatchResult;

	beforeAll(async () => {
		pg = new PGlite();
		await applyMigrations(pg, migrations);
		result = await applyChunk(pg, buildChunk(curatedFiles()));
	});

	it('writes every CSV as either a run or an unattributed file', () => {
		expect(result.runs + result.aborts).toBe(curated.list('stats').length);
		expect(result.aborts).toBeGreaterThan(0);
	});

	it('attaches every perf to exactly one run, with no orphans or ambiguity', () => {
		expect(result.orphanPerfs).toEqual([]);
		expect(result.ambiguousPerfs).toEqual([]);
		expect(result.hashMismatches).toEqual([]);
		expect(result.perfsMatched).toBe(curated.list('performances').length);
	});

	it('leaves the stage tables empty', async () => {
		const rows = await pg.query<{ n: number }>('select count(*)::int as n from stage_run');
		expect(rows.rows[0]!.n).toBe(0);
	});

	it('builds kill arrays in file order and a bot rollup that agrees with them', async () => {
		// The kill view unnests kill_series; run_bot is grouped from the same
		// staged rows, so any disagreement means the two scans diverged.
		const rows = await pg.query<{ run_id: number; from_kills: number; from_rollup: number }>(`
			select k.run_id,
			       count(*)::int as from_kills,
			       (select coalesce(sum(kills), 0)::int from run_bot rb where rb.run_id = k.run_id) as from_rollup
			from kill k group by k.run_id
		`);
		expect(rows.rows.length).toBeGreaterThan(0);
		for (const row of rows.rows) expect(row.from_rollup, `run ${row.run_id}`).toBe(row.from_kills);
	});

	it('gives every attached perf a tick series of matching length', async () => {
		const rows = await pg.query<{ n: number }>(`
			select count(*)::int as n from run_perf rp
			left join run_series rs on rs.run_id = rp.run_id
			where rs.run_id is null
		`);
		expect(rows.rows[0]!.n).toBe(0);
	});

	it('is idempotent — applying the same chunk again inserts nothing', async () => {
		const before = await pg.query<{ n: number }>('select count(*)::int as n from run');
		const again = await applyChunk(pg, buildChunk(curatedFiles()));
		const after = await pg.query<{ n: number }>('select count(*)::int as n from run');
		expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
		expect(again.runs).toBe(0);
	});
});
