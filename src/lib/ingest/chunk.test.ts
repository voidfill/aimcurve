import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { curated } from '../../../test/helpers/fixtures';
import { applyMigrations } from '../../db/migrate';
import { migrations } from '../../db/migrations';
import { buildChunk, STAGE_TABLES } from './chunk';
import { classify, fileStem } from './classify';
import { CopyWriter } from './copy';
import { parseStatsCsv } from '../parse/stats-csv';

function curatedFiles() {
	return [
		...curated.list('stats').map((name) => ({ name, bytes: curated.bytes('stats', name) })),
		...curated.list('performances').map((name) => ({ name, bytes: curated.bytes('performances', name) })),
	];
}

describe('classify', () => {
	it('splits the curated CSVs into the three documented shapes', () => {
		const kinds = curated.list('stats').map((name) => classify(name, parseStatsCsv(curated.text('stats', name))).kind);
		// The curated set is chosen to contain all three. See curated/README.md.
		expect(new Set(kinds)).toEqual(new Set(['complete', 'reset', 'abort']));
	});

	it('gives a complete run a start, a duration and an end-of-second write', () => {
		const name = curated.list('stats').find((n) => n.includes('Air Pure Medium') && n.includes('18.44.15'))!;
		const timing = classify(name, parseStatsCsv(curated.text('stats', name)));
		expect(timing.kind).toBe('complete');
		expect(timing.writtenAt.getMilliseconds()).toBe(999);
		expect(timing.startedAt).not.toBeNull();
		expect(timing.durationS!).toBeGreaterThan(1);
	});

	it('classifies the reset that is stamped with the next attempt start', () => {
		// 18.42.50 holds attempt B's stats but carries C's start: a degenerate
		// interval. See "The reset off-by-one" in docs/ingest.md.
		const name = curated.list('stats').find((n) => n.includes('Air Pure Medium') && n.includes('18.42.50'))!;
		const timing = classify(name, parseStatsCsv(curated.text('stats', name)));
		expect(timing).toMatchObject({ kind: 'reset', startedAt: null, startMs: null, durationS: null });
	});

	it('keeps a Challenge Start up to one minute after the file write as a reset', () => {
		const name = curated.list('stats').find((n) => n.includes('Air Pure Medium') && n.includes('18.44.15'))!;
		const csv = parseStatsCsv(curated.text('stats', name));
		csv.settings.challengeStart = '18:44:45.000';

		expect(classify(name, csv)).toMatchObject({ kind: 'reset', startedAt: null, startMs: null, durationS: null });
	});

	/** The curated complete run, re-stamped: written at `stamp`, started at `start`. */
	function timed(stamp: string, start: string) {
		const source = curated.list('stats').find((n) => n.includes('Air Pure Medium') && n.includes('18.44.15'))!;
		const csv = parseStatsCsv(curated.text('stats', source));
		csv.settings.challengeStart = start;
		return classify(source.replace('2026.09.18-18.44.15', stamp), csv);
	}

	// Tests run in Europe/Berlin, where both days are 25 or 23 hours long.
	it.each([
		['the clocks go back', '2026.10.25'],
		['the clocks go forward', '2026.03.29'],
	])('resolves Challenge Start on the wall clock on the day %s', (_, day) => {
		const timing = timed(`${day}-16.03.10`, '16:02:10.243');
		expect(timing.kind).toBe('complete');
		expect([timing.startedAt!.getHours(), timing.startedAt!.getMinutes()]).toEqual([16, 2]);
		expect(timing.durationS).toBeCloseTo(60.756, 3);
	});

	// 2026-10-25 in Berlin: 03:00 CEST (01:00Z) becomes 02:00 CET, so 02:xx happens twice.
	it.each([
		['a run started before midnight', '2026.09.19-00.00.41', '23:59:40.000', '2026-09-18T21:59:40.000Z', 61.999],
		['a run started before midnight, onto the clocks going back', '2026.10.25-00.00.41', '23:59:40.000', '2026-10-24T21:59:40.000Z', 61.999],
		['a run that crosses the clocks going back', '2026.10.25-02.00.30', '02:59:30.000', '2026-10-25T00:59:30.000Z', 60.999],
		['a run started in the repeated hour, written after it', '2026.10.25-03.00.30', '02:59:40.000', '2026-10-25T01:59:40.000Z', 50.999],
		// Undecidable from the CSV: both passes give 60 s. The first is taken.
		['a run inside the repeated hour', '2026.10.25-02.10.00', '02:09:00.000', '2026-10-25T00:09:00.000Z', 60.999],
	])('times %s', (_, stamp, start, startedAt, durationS) => {
		const timing = timed(stamp, start);
		expect(timing.kind).toBe('complete');
		expect(timing.startedAt!.toISOString()).toBe(startedAt);
		expect(timing.durationS).toBeCloseTo(durationS, 3);
	});

	it('strips the suffix to a stem shared by a CSV and its perf', () => {
		expect(fileStem('Air Pure Medium - Challenge - 2026.09.18-18.44.15 Stats.csv'))
			.toBe('Air Pure Medium - Challenge - 2026.09.18-18.44.15');
		expect(fileStem('Air Pure Medium - Challenge - 2026.09.18-18.44.15 Performance.perf'))
			.toBe('Air Pure Medium - Challenge - 2026.09.18-18.44.15');
	});
});

describe('CopyWriter', () => {
	it('round-trips values PostgreSQL would otherwise mangle', async () => {
		const pg = new PGlite();
		await pg.exec('create table t (a text, b text, c integer)');
		const writer = new CopyWriter();
		writer.row(['tab\there', 'newline\nhere', 1]);
		writer.row(['back\\slash', null, null]);
		writer.row(['\\N literal', 'plain', 3]);
		await pg.query(`copy t from '/dev/blob'`, [], { blob: new Blob([writer.bytes()]) });
		const rows = await pg.query<{ a: string; b: string | null; c: number | null }>('select * from t order by a');
		expect(rows.rows).toEqual([
			{ a: '\\N literal', b: 'plain', c: 3 },
			{ a: 'back\\slash', b: null, c: null },
			{ a: 'tab\there', b: 'newline\nhere', c: 1 },
		]);
	});
});

describe('buildChunk', () => {
	let pg: PGlite;

	beforeAll(async () => {
		pg = new PGlite();
		await applyMigrations(pg, migrations);
	});

	it('produces payloads every stage table accepts', async () => {
		const result = buildChunk(curatedFiles());
		expect(result.failures).toEqual([]);
		expect(result.csvStems.length).toBe(curated.list('stats').length);
		expect(result.perfStems.length).toBe(curated.list('performances').length);

		for (const table of STAGE_TABLES) {
			await pg.query(`copy ${table} from '/dev/blob'`, [], {
				blob: new Blob([result.payloads[table]!]),
			});
		}

		// Every CSV lands in exactly one of stage_run / stage_unattributed.
		const runs = await pg.query<{ n: number }>('select count(*)::int as n from stage_run');
		const aborts = await pg.query<{ n: number }>('select count(*)::int as n from stage_unattributed');
		expect(runs.rows[0]!.n + aborts.rows[0]!.n).toBe(curated.list('stats').length);

		// Ticks are staged with an index, and every perf produced some.
		const perfs = await pg.query<{ n: number }>('select count(*)::int as n from stage_perf');
		expect(perfs.rows[0]!.n).toBe(curated.list('performances').length);
		const ticks = await pg.query<{ n: number }>(
			'select count(distinct perf_file_stem)::int as n from stage_tick',
		);
		expect(ticks.rows[0]!.n).toBe(curated.list('performances').length);
	});

	it('reports a corrupt file and keeps the rest of the chunk', () => {
		const files = curatedFiles().slice(0, 4);
		files.splice(2, 0, { name: 'Broken - Challenge - 2026.01.01-00.00.00 Stats.csv', bytes: new TextEncoder().encode('nope') });
		const result = buildChunk(files);
		expect(result.failures.map((f) => f.name)).toEqual(['Broken - Challenge - 2026.01.01-00.00.00 Stats.csv']);
		expect(result.csvStems.length + result.perfStems.length).toBe(4);
	});
});
