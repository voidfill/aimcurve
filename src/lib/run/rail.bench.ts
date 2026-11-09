/**
 * The Run rail's queries over a 20k-run history: one page of attempts, and
 * the totals of the sessions a few loaded pages show.
 *
 * No thresholds are asserted. The cost of either query should follow the page
 * and the sessions on it, not the length of the history; a regression shows
 * up here as a jump between this history and a short one.
 *
 * As in `ingest.bench.ts`, `bench` is a test-context fixture in vitest 5, and
 * each `test` only hosts one `bench(...).run()`.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, test } from 'vitest';
import { makeTestDb } from '../../../test/helpers/db';
import { listAttempts, listSessionSummaries, type AttemptCursor } from './queries';

let pg: PGlite;
/** The cursor ten pages down, and the sessions of the first ten pages. */
let deep: AttemptCursor;
let sessionsOf10Pages: number[];
let sessionsOf1Page: number[];

/**
 * 20,000 runs in sessions of 50, two minutes apart, 20 hours between
 * sessions; each session plays five of 40 scenarios. Every seventh run is a
 * reset, which counts for sessions but not for scores.
 */
beforeAll(async () => {
	({ pg } = await makeTestDb());
	await pg.exec(`
		insert into scenario (hash, name) select md5(i::text), 'Scenario ' || i from generate_series(1, 40) i;
		insert into game_version (label) values ('3.9.5');
		insert into config (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
			fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
			resolution_scale, max_fps_config, input_lag)
		values ('cm/360', 0.0123, 1.5, 1.5, 1600, 103, 'Overwatch', false,
			'blank.png', 1.0, '010101FF', '3440x1440', 100, 999, 0);
		insert into run (file_stem, scenario_id, config_id, game_version_id, kind, started_at,
			start_ms, written_at, duration_s, score, kills, hit_count, miss_count, shots)
		select 'r' || i, ((i / 50 * 5 + (i % 50) / 10) % 40) + 1, 1, 1,
		       (case when i % 7 = 0 then 'reset' else 'complete' end)::run_kind,
		       case when i % 7 <> 0 then w - interval '1 minute' end,
		       case when i % 7 <> 0 then 0 end,
		       w,
		       case when i % 7 <> 0 then 60 end,
		       500 + (i * 37) % 97, 0, 0, 0, 0
		from (
			select i, timestamptz '2024-01-01' + (i / 50) * interval '20 hours' + (i % 50) * interval '2 minutes' as w
			from generate_series(0, 19999) i
		) g;
		analyze;
	`);
	let before: AttemptCursor | null = null;
	const sessions = new Set<number>();
	for (let page = 0; page < 10; page += 1) {
		const result = await listAttempts(pg, null, before);
		result.items.forEach((a) => sessions.add(a.sessionId));
		if (page === 0) sessionsOf1Page = [...sessions];
		before = result.next!;
	}
	deep = before!;
	sessionsOf10Pages = [...sessions];
}, 120_000);

test('first page', async ({ bench }) => {
	await bench('listAttempts, first page of 20k', async () => {
		await listAttempts(pg, null, null);
	}).run();
});

test('deep page', async ({ bench }) => {
	await bench('listAttempts, eleventh page of 20k', async () => {
		await listAttempts(pg, null, deep);
	}).run();
});

test('filtered page', async ({ bench }) => {
	await bench('listAttempts, one scenario', async () => {
		await listAttempts(pg, 3, null);
	}).run();
});

test('sessions of one page', async ({ bench }) => {
	await bench('listSessionSummaries, one page of sessions', async () => {
		await listSessionSummaries(pg, sessionsOf1Page, null);
	}).run();
});

test('sessions of ten pages', async ({ bench }) => {
	await bench('listSessionSummaries, ten pages of sessions', async () => {
		await listSessionSummaries(pg, sessionsOf10Pages, null);
	}).run();
});
