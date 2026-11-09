import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../../test/helpers/db';
import { listAttempts, listSessionSummaries } from './queries';

let pg: PGlite;

/** `[file stem, scenario id, kind, written at, score]`, inserted in this order. */
type Run = [string, number, 'complete' | 'reset', string, number | null];

async function insertRuns(runs: Run[]): Promise<void> {
	for (const [stem, scenario, kind, writtenAt, score] of runs) {
		// Only a completion has a start and a duration.
		const complete = kind === 'complete';
		await pg.query(
			`insert into run (file_stem, scenario_id, config_id, game_version_id, kind, started_at,
				start_ms, written_at, duration_s, score, kills, hit_count, miss_count, shots)
			 values ($1, $2, 1, 1, $3::run_kind,
				case when $6::boolean then $4::timestamptz - interval '1 minute' end,
				case when $6::boolean then 0 end, $4::timestamptz,
				case when $6::boolean then 60 end, $5, 0, 0, 0, 0)`,
			[stem, scenario, kind, writtenAt, score, complete],
		);
	}
}

/**
 * Three sessions, each more than 30 minutes after the last, named by their
 * first run's id: 1: A 50, A 60, B 100 · 4: A 70, A 80, B 90 · 7: A 75, a
 * reset of A.
 */
beforeEach(async () => {
	({ pg } = await makeTestDb());
	await pg.exec(`
		insert into scenario (hash, name) values ('${'a'.repeat(32)}', 'A'), ('${'b'.repeat(32)}', 'B');
		insert into game_version (label) values ('3.9.5');
		insert into config (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
			fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
			resolution_scale, max_fps_config, input_lag)
		values ('cm/360', 0.0123, 1.5, 1.5, 1600, 103, 'Overwatch', false,
			'blank.png', 1.0, '010101FF', '3440x1440', 100, 999, 0);
	`);
	await insertRuns([
		['a1', 1, 'complete', '2026-01-01 10:02Z', 50],
		['a2', 1, 'complete', '2026-01-01 10:04Z', 60],
		['b1', 2, 'complete', '2026-01-01 10:06Z', 100],
		['a3', 1, 'complete', '2026-01-02 10:02Z', 70],
		['a4', 1, 'complete', '2026-01-02 10:04Z', 80],
		['b2', 2, 'complete', '2026-01-02 10:06Z', 90],
		['a5', 1, 'complete', '2026-01-03 10:02Z', 75],
		['ax', 1, 'reset', '2026-01-03 10:03Z', 10],
	]);
});

describe('listAttempts', () => {
	it('carries each row’s previous score, prior PB and session', async () => {
		const { items } = await listAttempts(pg, null, null);
		expect(items.map((a) => [a.fileStem, a.prevScore, a.pbBefore, a.sessionId])).toEqual([
			['a5', 80, 80, 7],
			['b2', 100, 100, 4],
			['a4', 70, 70, 4],
			['a3', 60, 60, 4],
			['b1', null, null, 1],
			['a2', 50, 50, 1],
			['a1', null, null, 1],
		]);
	});

	it('keeps the history across scenarios when filtered', async () => {
		const { items } = await listAttempts(pg, 2, null);
		expect(items.map((a) => [a.fileStem, a.prevScore, a.sessionId])).toEqual([
			['b2', 100, 4],
			['b1', null, 1],
		]);
	});
});

describe('listAttempts history edge cases', () => {
	it('skips a scoreless completion for the previous score but keeps the prior best', async () => {
		await insertRuns([
			['n1', 2, 'complete', '2026-01-04 10:02Z', null],
			['n2', 2, 'complete', '2026-01-04 10:04Z', 95],
		]);
		const { items } = await listAttempts(pg, 2, null);
		expect(items.slice(0, 2).map((a) => [a.fileStem, a.prevScore, a.pbBefore])).toEqual([
			['n2', 90, 100],
			['n1', 90, 100],
		]);
	});

	it('names a session by its first run even when that run is a reset', async () => {
		await insertRuns([
			['z0', 1, 'reset', '2026-01-05 10:00Z', 1],
			['z1', 1, 'complete', '2026-01-05 10:10Z', 77],
		]);
		const [latest] = (await listAttempts(pg, null, null)).items;
		expect(latest!.fileStem).toBe('z1');
		const reset = await pg.query<{ id: number }>(`select id from run where file_stem = 'z0'`);
		expect(latest!.sessionId).toBe(reset.rows[0]!.id);
	});
});

describe('session identity', () => {
	it('splits runs into the same sessions as run_session, at exactly 30 minutes and just past it', async () => {
		await insertRuns([
			['g1', 2, 'complete', '2026-01-06 10:00Z', 1],
			// Exactly 30 minutes later: the same session.
			['g2', 2, 'reset', '2026-01-06 10:30Z', 1],
			['g3', 2, 'complete', '2026-01-06 11:00Z', 2],
			// 30 minutes and a second later: a new one.
			['g4', 2, 'complete', '2026-01-06 11:30:01Z', 3],
		]);
		const { items } = await listAttempts(pg, null, null);
		const view = await pg.query<{ file_stem: string; session_id: number }>(
			'select r.file_stem, s.session_id::integer as session_id from run_session s join run r on r.id = s.id',
		);
		const viewSession = new Map(view.rows.map((r) => [r.file_stem, r.session_id]));
		// Same partition: two rows share a session here exactly when they do in the view.
		for (const x of items)
			for (const y of items)
				expect(x.sessionId === y.sessionId, `${x.fileStem} / ${y.fileStem}`).toBe(
					viewSession.get(x.fileStem) === viewSession.get(y.fileStem),
				);
		expect(new Set(items.map((a) => a.sessionId)).size).toBe(5);
	});
});

describe('listSessionSummaries', () => {
	it('totals whole sessions, with baselines from earlier sessions only', async () => {
		const summaries = await listSessionSummaries(pg, [7, 4], null);
		expect(summaries).toEqual([
			{
				sessionId: 7,
				startedAt: '2026-01-03T10:01:00.000Z',
				endedAt: '2026-01-03T10:02:00.000Z',
				runs: 1,
				scenarios: [{ scenarioId: 1, median: 75, best: 75, baseline: 65, prevBest: 80 }],
			},
			{
				sessionId: 4,
				startedAt: '2026-01-02T10:01:00.000Z',
				endedAt: '2026-01-02T10:06:00.000Z',
				runs: 3,
				scenarios: [
					{ scenarioId: 1, median: 75, best: 80, baseline: 55, prevBest: 60 },
					{ scenarioId: 2, median: 90, best: 90, baseline: 100, prevBest: 100 },
				],
			},
		]);
	});

	it('scopes the counts to the filtered scenario', async () => {
		const [summary] = await listSessionSummaries(pg, [4], 2);
		expect(summary).toMatchObject({ runs: 1, scenarios: [{ scenarioId: 2, best: 90 }] });
	});

	it('leaves a first session without a baseline', async () => {
		const [summary] = await listSessionSummaries(pg, [1], null);
		expect(summary!.scenarios.every((s) => s.baseline === null && s.prevBest === null)).toBe(true);
	});
});
