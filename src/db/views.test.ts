import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../test/helpers/db';

let pg: PGlite;

/**
 * Three runs on scenario 1, in written order:
 * r1 (complete, 900) -> r2 (reset) -> r3 (complete, 1100),
 * with kill, bot, perf and tick detail on r1.
 */
beforeEach(async () => {
	({ pg } = await makeTestDb());
	await pg.exec(`
		insert into scenario (hash, name) values ('${'a'.repeat(32)}', 'Air Voltaic');
		insert into game_version (label) values ('3.9.5');
		insert into bot (name) values ('air1_far_short'), ('speedswitch');
		insert into weapon (name) values ('pistol');
		insert into config (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
			fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
			resolution_scale, max_fps_config, input_lag)
		values ('cm/360', 0.0123, 1.5, 1.5, 1600, 103, 'Overwatch', false,
			'blank.png', 1.0, '010101FF', '3440x1440', 100, 999, 0);

		insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
			started_at, start_ms, written_at, duration_s, score, kills,
			hit_count, miss_count, shots, damage_done, damage_possible, avg_fps)
		values ('r1', 1, 1, 1, 'complete', '2026-01-01 10:20:00.503Z', 37200503,
			'2026-01-01 10:21:00.999Z', 60.5, 900, 2, 70, 30, 100, 700, 1000, 420),
		       ('r3', 1, 1, 1, 'complete', '2026-01-01 10:30:00.100Z', 37800100,
			'2026-01-01 10:31:00.900Z', 60.8, 1100, 2, 80, 20, 100, 800, 1000, 430);

		insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
			written_at, score, kills, hit_count, miss_count, shots)
		values ('r2', 1, 1, 1, 'reset', '2026-01-01 10:25:00Z', 142.0, 0, 12, 4, 16);

		insert into kill_series values
		(1, '{37200600,37201200}', '{1,2}', '{1,1}', '{0.44,0.31}', '{3,2}', '{2,2}',
		    '{100,100}', '{150,120}', '{0,1}', '{0,1}');

		insert into run_bot values (1, 1, 1, 0.44, 3, 2, 100, 150, 0),
		                           (1, 2, 1, 0.31, 2, 2, 100, 120, 1),
		                           -- r3 is id 2: r2 was inserted after it, in its own statement.
		                           (2, 1, 1, 0.40, 3, 2, 100, 150, 0),
		                           (2, 2, 1, 0.29, 2, 2, 100, 120, 0);

		insert into run_perf (run_id, perf_file_stem, schema_version, challenge_start_utc, added_bots)
		values (1, 'r1-perf', 1, '2026-01-01 10:20:00Z', '{air.bot}');

		insert into run_series (run_id, t, score) values (1, '{1,2,3}', '{100,110,90}');
	`);
});

describe('tick', () => {
	it('numbers ticks from zero and leaves an absent metric null, not zero', async () => {
		const r = await pg.query<{ tick_no: number; score: number; reloads: number | null }>(
			'select tick_no, score, reloads from tick where run_id = 1 order by tick_no',
		);
		expect(r.rows.map((row) => row.tick_no)).toEqual([0, 1, 2]);
		expect(r.rows.map((row) => row.score)).toEqual([100, 110, 90]);
		expect(r.rows.every((row) => row.reloads === null)).toBe(true);
	});
});

describe('kill', () => {
	it('exposes cheated as a boolean and t_offset against Challenge Start', async () => {
		const r = await pg.query<{ ordinal: number; cheated: boolean; t_offset: number }>(
			'select ordinal, cheated, t_offset from kill where run_id = 1 order by ordinal',
		);
		expect(r.rows.map((row) => row.cheated)).toEqual([false, true]);
		expect(r.rows[0]!.t_offset).toBeCloseTo(0.097, 3);
		expect(r.rows[1]!.t_offset).toBeCloseTo(0.697, 3);
	});
});

describe('run_complete', () => {
	it('excludes resets, resolves dimensions, and derives has_perf', async () => {
		const r = await pg.query<{ file_stem: string; scenario_name: string; has_perf: boolean }>(
			'select file_stem, scenario_name, has_perf from run_complete order by file_stem',
		);
		expect(r.rows).toEqual([
			{ file_stem: 'r1', scenario_name: 'Air Voltaic', has_perf: true },
			{ file_stem: 'r3', scenario_name: 'Air Voltaic', has_perf: false },
		]);
	});
});

describe('run_attempt', () => {
	it('numbers every attempt and counts the resets that preceded each', async () => {
		const r = await pg.query<{ attempt_no: number; kind: string; resets_before: number }>(
			`select attempt_no, kind, resets_before::int as resets_before
			 from run_attempt where scenario_id = 1 order by attempt_no`,
		);
		expect(r.rows).toEqual([
			{ attempt_no: 1, kind: 'complete', resets_before: 0 },
			{ attempt_no: 2, kind: 'reset', resets_before: 0 },
			{ attempt_no: 3, kind: 'complete', resets_before: 1 },
		]);
	});
});

describe('run_progress', () => {
	it('numbers completions and reports the PB that preceded each', async () => {
		const r = await pg.query<{ completion_no: number; score: number; pb_before: number | null }>(
			`select completion_no::int as completion_no, score, pb_before
			 from run_progress where scenario_id = 1 order by completion_no`,
		);
		expect(r.rows).toEqual([
			{ completion_no: 1, score: 900, pb_before: null },
			{ completion_no: 2, score: 1100, pb_before: 900 },
		]);
	});

	it('pushes a partition-key filter down to the index', async () => {
		// Filtering on anything else computes the window over every row first;
		// this is the single easiest way to make the schema slow. Three rows is
		// far too few for the planner to choose an index on cost, so the point
		// being asserted is that the filter *can* reach the index at all.
		await pg.exec('set enable_seqscan = off');
		const plan = await pg.query<{ 'QUERY PLAN': string }>(
			'explain (costs off) select * from run_progress where scenario_id = 1',
		);
		await pg.exec('reset enable_seqscan');
		expect(plan.rows.map((row) => row['QUERY PLAN']).join('\n')).toMatch(/run_scenario_time/);
	});
});

describe('run_session', () => {
	it('segments on a gap of more than 30 minutes and includes resets', async () => {
		await pg.exec(`
			insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
				started_at, start_ms, written_at, duration_s, score, kills,
				hit_count, miss_count, shots)
			values ('r4', 1, 1, 1, 'complete', '2026-01-01 14:00:00Z', 50400000,
				'2026-01-01 14:01:00Z', 60, 1200, 2, 70, 30, 100)
		`);
		const r = await pg.query<{
			file_stem: string;
			session_id: number;
			position_in_session: number;
		}>(`
			select r.file_stem, s.session_id::int as session_id,
			       s.position_in_session::int as position_in_session
			from run_session s join run r on r.id = s.id order by s.written_at
		`);
		expect(r.rows).toEqual([
			{ file_stem: 'r1', session_id: 1, position_in_session: 1 },
			{ file_stem: 'r2', session_id: 1, position_in_session: 2 },
			{ file_stem: 'r3', session_id: 1, position_in_session: 3 },
			{ file_stem: 'r4', session_id: 2, position_in_session: 1 },
		]);
	});
});

describe('worked queries', () => {
	it('summarises a scenario distribution', async () => {
		const r = await pg.query<{ n: number; p50: number; best: number }>(
			`select count(*)::int as n,
			        percentile_cont(0.5) within group (order by score) as p50,
			        max(score) as best
			 from run_complete where scenario_id = $1`,
			[1],
		);
		expect(r.rows[0]).toMatchObject({ n: 2, p50: 1000, best: 1100 });
	});

	it('breaks a run down by bot against the rest of the scenario', async () => {
		const r = await pg.query<{ bot_id: number; avg_ttk: number; p50_ttk: number }>(
			`with target as (select id, scenario_id from run where id = $1),
			 mine as (
			   select b.bot_id, b.kills, b.avg_ttk, b.accuracy
			   from run_bot b join target t on t.id = b.run_id
			 ),
			 history as (
			   select b.bot_id,
			          count(*) as runs,
			          percentile_cont(0.5) within group (order by b.avg_ttk)  as p50_ttk,
			          percentile_cont(0.9) within group (order by b.avg_ttk)  as p90_ttk,
			          min(b.avg_ttk)                                          as best_ttk,
			          percentile_cont(0.5) within group (order by b.accuracy) as p50_accuracy,
			          percentile_cont(0.9) within group (order by b.accuracy) as p90_accuracy,
			          max(b.accuracy)                                         as best_accuracy
			   from run_bot b
			   join run_complete r on r.id = b.run_id
			   join target t on t.scenario_id = r.scenario_id
			   where b.run_id <> t.id
			   group by b.bot_id
			 )
			 select * from mine left join history using (bot_id) order by bot_id`,
			[1],
		);
		expect(r.rows.map((row) => [row.bot_id, row.avg_ttk])).toEqual([
			[1, 0.44],
			[2, 0.31],
		]);
		// The target run is excluded from its own comparison population, so the
		// percentiles come from r3 alone.
		expect(r.rows[0]!.p50_ttk).toBeCloseTo(0.4);
	});

	it('reports the reroll rate per scenario', async () => {
		const r = await pg.query<{ resets: number; completes: number }>(`
			select scenario_id,
			       count(*) filter (where kind = 'reset')::int    as resets,
			       count(*) filter (where kind = 'complete')::int as completes
			from run group by scenario_id
		`);
		expect(r.rows[0]).toMatchObject({ resets: 1, completes: 2 });
	});

	it('buckets the score curve on elapsed time, not tick_no', async () => {
		// The ~1 Hz cadence is not uniform, so tick_no is a per-run ordinal and
		// not a cross-run clock; the HAVING keeps the tail off a shrinking
		// population. One run here, so the support floor is 1.
		const r = await pg.query<{ second: number; n: number }>(
			`with cum as (
			   select run_id, floor(t)::int as second,
			          sum(score) over (partition by run_id order by t) as c
			   from tick
			   where run_id in (select id from run_complete where scenario_id = $2)
			 ),
			 band as (
			   select second, count(*)::int as n,
			          percentile_cont(0.5) within group (order by c) as p50,
			          percentile_cont(0.9) within group (order by c) as p90
			   from cum group by second
			   having count(*) >= 1
			 ),
			 mine as (
			   select floor(t)::int as second, sum(score) over (order by t) as c
			   from tick where run_id = $1
			 )
			 select * from mine full join band using (second) order by second`,
			[1, 1],
		);
		expect(r.rows.map((row) => row.second)).toEqual([1, 2, 3]);
		expect(r.rows.map((row) => row.n)).toEqual([1, 1, 1]);
	});
});
