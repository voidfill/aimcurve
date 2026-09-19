import { PGlite } from '@electric-sql/pglite';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { curated, raw } from '../../../test/helpers/fixtures';
import { applyMigrations } from '../../db/migrate';
import { migrations } from '../../db/migrations';
import { ingest } from './index';
import type { FileSource } from './source';
import { nodeSource } from './source-node';

async function freshDb(): Promise<PGlite> {
	const pg = new PGlite();
	await applyMigrations(pg, migrations);
	return pg;
}

function curatedSource(): FileSource {
	return nodeSource(join(curated.dir, 'stats'), join(curated.dir, 'performances'));
}

describe('ingest over the curated fixtures', () => {
	it('imports every file, then skips every file on a second pass', async () => {
		const pg = await freshDb();
		const first = await ingest(curatedSource(), pg);
		expect(first.failures).toEqual([]);
		expect(first.orphanPerfs).toEqual([]);
		expect(first.ambiguousPerfs).toEqual([]);
		expect(first.runs + first.aborts).toBe(curated.list('stats').length);
		expect(first.perfsMatched).toBe(curated.list('performances').length);

		const second = await ingest(curatedSource(), pg);
		expect(second.skipped).toBe(second.scanned);
		expect(second.runs).toBe(0);
		expect(second.perfsMatched).toBe(0);
	});

	it('names a corrupt file and imports everything else', async () => {
		const pg = await freshDb();
		const base = curatedSource();
		const broken: FileSource = {
			async list() {
				const entries = await base.list();
				return [
					...entries,
					{
						name: 'Broken - Challenge - 2026.01.01-00.00.00 Stats.csv',
						open: async () => new File(['nope'], 'Broken - Challenge - 2026.01.01-00.00.00 Stats.csv'),
					},
				];
			},
		};
		const report = await ingest(broken, pg, { chunkSize: 8 });
		expect(report.failures.map((f) => f.name)).toEqual(['Broken - Challenge - 2026.01.01-00.00.00 Stats.csv']);
		expect(report.runs + report.aborts).toBe(curated.list('stats').length);
	});

	it('retries a perf whose CSV arrived in a later chunk', async () => {
		const pg = await freshDb();
		// chunkSize 1 guarantees every perf is staged in a chunk of its own,
		// several of them before their CSV has been inserted. The end-of-pass
		// retry is the only thing that can rescue them.
		const report = await ingest(curatedSource(), pg, { chunkSize: 1 });
		expect(report.orphanPerfs).toEqual([]);
		expect(report.perfsMatched).toBe(curated.list('performances').length);
	});
});

describe.skipIf(!raw.available)('ingest over the full dump', () => {
	it("re-derives docs/ingest.md's join measurement", async () => {
		const pg = await freshDb();
		const source = nodeSource(join(raw.dir, 'stats'), join(raw.dir, 'performances'));
		const report = await ingest(source, pg);

		expect(report.failures).toEqual([]);
		// "A .perf has no CSV" means something upstream is broken, not that
		// there is data to salvage. 0 in 2164 files.
		expect(report.orphanPerfs).toEqual([]);
		expect(report.ambiguousPerfs).toEqual([]);
		expect(report.hashMismatches).toEqual([]);
		expect(report.perfsMatched).toBe(raw.list('performances').length);

		// No run claims two perfs: run_perf.run_id is the primary key, so this
		// is structural — but the count is the thing ingest.md measured.
		const runs = await pg.query<{ n: number }>('select count(*)::int as n from run');
		expect(runs.rows[0]!.n + report.aborts).toBe(raw.list('stats').length);

		// 310 complete CSVs predate .perf entirely. Keeping them is the point:
		// it is the earliest history, where progression is most visible.
		const csvOnly = await pg.query<{ n: number }>(`
			select count(*)::int as n from run r
			left join run_perf rp on rp.run_id = r.id
			where r.kind = 'complete' and rp.run_id is null
		`);
		expect(csvOnly.rows[0]!.n).toBeGreaterThan(100);
	}, 600_000);
});
