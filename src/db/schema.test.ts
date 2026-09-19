import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../test/helpers/db';

let pg: PGlite;

/** 32 hex characters, the shape of a KovaaK's scenario hash. */
const HASH = 'a'.repeat(32);

/** The 15 client-configuration keys, as one row. */
const CONFIG_VALUES = `'cm/360', 0.0123, 1.5, 1.5, 1600, 103, 'Overwatch', false,
	'blank.png', 1.0, '010101FF', '3440x1440', 100, 999, 0`;

const INSERT_CONFIG = `
	insert into config (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
		fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
		resolution_scale, max_fps_config, input_lag)
	values (${CONFIG_VALUES})
	on conflict do nothing
	returning id
`;

beforeEach(async () => {
	({ pg } = await makeTestDb());
});

/**
 * A scenario, game version, two bots, a weapon and a config.
 *
 * Every identity column starts at 1 here because `beforeEach` builds a fresh
 * database per test. Identity sequences advance even on rejected inserts, so
 * seeding after a test that provokes a CHECK violation would not give id 1.
 */
async function seedDimensions(): Promise<void> {
	await pg.exec(`
		insert into scenario (hash, name) values ('${HASH}', 'Air Voltaic');
		insert into game_version (label) values ('3.9.5');
		insert into bot (name) values ('air1_far_short'), ('speedswitch');
		insert into weapon (name) values ('pistol');
	`);
	await pg.query(INSERT_CONFIG);
}

/** A complete run. Times are explicit, so the exclusion constraint is testable. */
function completeRun(stem: string, startedAt: string, writtenAt: string, score: number): string {
	return `
		insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
			started_at, start_ms, written_at, duration_s, score, kills,
			hit_count, miss_count, shots, damage_done, damage_possible, avg_fps)
		values ('${stem}', 1, 1, 1, 'complete', '${startedAt}',
			37200503, '${writtenAt}', 60.5, ${score}, 2, 70, 30, 100, 700, 1000, 420)
	`;
}

describe('dimensions', () => {
	it('interns a scenario by hash', async () => {
		await pg.exec(`insert into scenario (hash, name) values ('${HASH}', 'Air Voltaic')`);
		const r = await pg.query<{ name: string }>('select name from scenario');
		expect(r.rows).toEqual([{ name: 'Air Voltaic' }]);
	});

	it('rejects an untrimmed or empty bot or weapon name', async () => {
		// " speedswitch " and "speedswitch" alternate within one corpus file;
		// interning verbatim would fork one bot into two dimension rows.
		await expect(pg.exec(`insert into bot (name) values (' speedswitch ')`)).rejects.toThrow(
			/bot_name_trimmed/,
		);
		await expect(pg.exec(`insert into bot (name) values ('')`)).rejects.toThrow(
			/bot_name_trimmed/,
		);
		await expect(pg.exec(`insert into weapon (name) values (' pistol')`)).rejects.toThrow(
			/weapon_name_trimmed/,
		);
	});

	it('deduplicates a config on the natural key over all 15 columns', async () => {
		const first = await pg.query<{ id: number }>(INSERT_CONFIG);
		expect(first.rows).toEqual([{ id: 1 }]);
		const second = await pg.query<{ id: number }>(INSERT_CONFIG);
		expect(second.rows).toEqual([]);
	});

	it('defines run_kind with exactly two values', async () => {
		const r = await pg.query<{ enumlabel: string }>(`
			select enumlabel from pg_enum e
			join pg_type t on t.oid = e.enumtypid
			where t.typname = 'run_kind' order by e.enumsortorder
		`);
		expect(r.rows.map((row) => row.enumlabel)).toEqual(['complete', 'reset']);
	});
});

describe('run', () => {
	beforeEach(seedDimensions);

	it('accepts a complete run and derives accuracy, efficiency and span', async () => {
		await pg.exec(completeRun('r1', '2026-01-01 10:20:00.503Z', '2026-01-01 10:21:00.999Z', 900));
		const r = await pg.query<{ accuracy: number; efficiency: number; span: unknown }>(
			'select accuracy, efficiency, span from run where file_stem = $1',
			['r1'],
		);
		expect(r.rows[0]!.accuracy).toBeCloseTo(0.7);
		expect(r.rows[0]!.efficiency).toBeCloseTo(0.7);
		expect(r.rows[0]!.span).not.toBeNull();
	});

	it('accepts a reset with no start time, and leaves its span null', async () => {
		// Score survives: it is non-zero in 16 of the corpus's 21 resets, because
		// it is a raw accumulator rather than something derived at run end.
		await pg.exec(`
			insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
				written_at, score, kills, hit_count, miss_count, shots)
			values ('r2', 1, 1, 1, 'reset', '2026-01-01 10:25:00Z', 142.0, 0, 12, 4, 16)
		`);
		const r = await pg.query<{ span: unknown; score: number }>(
			'select span, score from run where file_stem = $1',
			['r2'],
		);
		expect(r.rows[0]).toMatchObject({ span: null, score: 142 });
	});

	it('rejects a reset that carries a start time', async () => {
		// A reset file is stamped with the *next* attempt's start; storing that
		// in a column named started_at is an invitation to use it.
		//
		// Only started_at is supplied: filling start_ms and duration_s too would
		// violate three CHECKs at once, and Postgres reports whichever it reaches
		// first, so the assertion could not name the constraint under test.
		await expect(
			pg.exec(`
				insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
					started_at, written_at, hit_count, miss_count, shots)
				values ('bad', 1, 1, 1, 'reset', '2026-01-01 11:00:00Z',
					'2026-01-01 11:00:30Z', 1, 1, 2)
			`),
		).rejects.toThrow(/complete_has_start/);
	});

	it('rejects an Avg FPS on a reset', async () => {
		// Uninitialised memory there, observed up to 8.9e9.
		await expect(
			pg.exec(`
				insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
					written_at, hit_count, miss_count, shots, avg_fps)
				values ('bad', 1, 1, 1, 'reset', '2026-01-01 11:00:00Z', 1, 1, 2, 7.3e9)
			`),
		).rejects.toThrow(/fps_only_when_complete/);
	});

	it('rejects shots that do not balance hits and misses', async () => {
		await expect(
			pg.exec(`
				insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
					written_at, hit_count, miss_count, shots)
				values ('bad', 1, 1, 1, 'reset', '2026-01-01 11:00:00Z', 70, 30, 99)
			`),
		).rejects.toThrow(/shots_balance/);
	});

	it('rejects a complete run that does not end after it starts', async () => {
		// The empty range would otherwise escape the exclusion constraint entirely.
		await expect(
			pg.exec(completeRun('bad', '2026-01-01 12:00:00Z', '2026-01-01 12:00:00Z', 10)),
		).rejects.toThrow(/complete_ends_after_start/);
	});

	it('rejects two overlapping complete runs but accepts an overlapping reset', async () => {
		await pg.exec(completeRun('r1', '2026-01-01 10:20:00.503Z', '2026-01-01 10:21:00.999Z', 900));
		await expect(
			pg.exec(completeRun('r3', '2026-01-01 10:20:30Z', '2026-01-01 10:21:30Z', 950)),
		).rejects.toThrow(/no_overlapping_runs/);
		await expect(
			pg.exec(`
				insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
					written_at, hit_count, miss_count, shots)
				values ('r2', 1, 1, 1, 'reset', '2026-01-01 10:20:30Z', 1, 1, 2)
			`),
		).resolves.toBeDefined();
	});

	it('finds the run a .perf belongs to, given a whole-second start', async () => {
		// challenge_start_utc is the CSV start truncated to the second, so it is
		// almost always *earlier* than started_at: containment finds nothing, and
		// the join needs the 1000 ms of lower-bound slack ingest.md specifies.
		// The kind predicate is required — the index is partial.
		await pg.exec(completeRun('r1', '2026-01-01 10:20:00.503Z', '2026-01-01 10:21:00.999Z', 900));
		const probe = '2026-01-01 10:20:00Z';
		const contained = await pg.query(
			`select file_stem from run where kind = 'complete' and span @> $1::timestamptz`,
			[probe],
		);
		expect(contained.rows).toEqual([]);
		const overlapped = await pg.query<{ file_stem: string }>(
			`select file_stem from run
			 where kind = 'complete'
			   and span && tstzrange($1::timestamptz, $1::timestamptz + interval '1 second')`,
			[probe],
		);
		expect(overlapped.rows).toEqual([{ file_stem: 'r1' }]);
	});

	it('keeps an abort out of run, with its whole document', async () => {
		await pg.exec(`
			insert into unattributed_file (file_stem, written_at, payload)
			values ('abort', '2026-01-01 13:00:00Z', '{"weapons":[{"shots":1306,"hits":827}]}')
		`);
		const r = await pg.query<{ shots: number }>(
			`select (payload -> 'weapons' -> 0 ->> 'shots')::int as shots from unattributed_file`,
		);
		expect(r.rows).toEqual([{ shots: 1306 }]);
	});
});
