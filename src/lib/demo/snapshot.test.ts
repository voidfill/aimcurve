/**
 * The demo snapshot: generated from the demo fixtures by the real ingest and
 * queries, matched against the committed file, and answering exactly as the
 * database does. `pnpm gen:demo` rewrites the committed file.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb } from '../../../test/helpers/db';
import { demo } from '../../../test/helpers/fixtures';
import { pgSource, type DataSource } from '../data-source';
import { applyChunk } from '../ingest/batch';
import { buildChunk } from '../ingest/chunk';
import { curveFor } from '../scoring';
import { buildSnapshot } from './build';
import { DEMO_PROGRESS_HASH, DEMO_RUN_STEM, DEMO_SCENARIO_HASH, type DemoSnapshot, snapshotSource } from './snapshot';

const LFS_POINTER = 'version https://git-lfs';

function demoFiles() {
	return [
		...demo.list('stats').map((name) => ({ name, bytes: demo.bytes('stats', name) })),
		...demo.list('performances').map((name) => ({ name, bytes: demo.bytes('performances', name) })),
	];
}

describe('demo snapshot', () => {
	let pg: PGlite;
	let snapshot: DemoSnapshot;
	let db: DataSource;
	let snap: DataSource;

	beforeAll(async () => {
		// Loud, before anything is ingested: a checkout without LFS has pointer
		// files here, and ingesting them would produce an empty demo.
		const first = demo.text('stats', demo.list('stats')[0]!);
		if (first.startsWith(LFS_POINTER)) throw new Error('test/fixtures/demo holds LFS pointers: run `git lfs pull`');
		({ pg } = await makeTestDb());
		await applyChunk(pg, buildChunk(demoFiles()));
		snapshot = await buildSnapshot(pg);
		// Through JSON, as the browser receives it.
		snapshot = JSON.parse(JSON.stringify(snapshot)) as DemoSnapshot;
		db = pgSource(pg);
		snap = snapshotSource(snapshot);
	});

	it('holds every demo fixture as a completed, charted run of a demo scenario', () => {
		// The fixtures are completed runs only (see test/fixtures/demo/README.md),
		// so every CSV is an attempt and every attempt has a curve.
		const n = demo.list('stats').length;
		expect(Object.keys(snapshot.attempts)).toHaveLength(n);
		expect(Object.keys(snapshot.scoringInputs)).toHaveLength(n);
		const runs = (hash: string) => snapshot.history[snapshot.scenarios[hash]!.id]!.length;
		expect(runs(DEMO_SCENARIO_HASH) + runs(DEMO_PROGRESS_HASH)).toBe(n);
		// Enough history for the progression chart's median of ten to mean something.
		expect(runs(DEMO_PROGRESS_HASH)).toBeGreaterThanOrEqual(30);
	});

	it('has a curve for the run About charts', () => {
		const attempt = snapshot.attempts[DEMO_RUN_STEM];
		expect(attempt).toBeDefined();
		const input = snapshot.scoringInputs[attempt!.id];
		expect(input && curveFor(input)).toBeTruthy();
	});

	it('matches the committed file', async () => {
		await expect(JSON.stringify(snapshot)).toMatchFileSnapshot('../../data/demo-snapshot.json');
	});

	describe('answers as the database does', () => {
		let scenarioId: number;
		let ids: number[];

		beforeAll(async () => {
			const scenario = await db.getScenario(DEMO_SCENARIO_HASH);
			scenarioId = scenario!.id;
			ids = (await db.listScenarioRuns(scenarioId)).map((r) => r.id);
		});

		it('getAttempt', async () => {
			expect(await snap.getAttempt(DEMO_RUN_STEM)).toEqual(await db.getAttempt(DEMO_RUN_STEM));
			expect(await snap.getAttempt('nope')).toEqual(await db.getAttempt('nope'));
		});

		it('getScenario', async () => {
			expect(await snap.getScenario(DEMO_SCENARIO_HASH)).toEqual(await db.getScenario(DEMO_SCENARIO_HASH));
			expect(await snap.getScenario('nope')).toEqual(await db.getScenario('nope'));
		});

		it('listVersions', async () => {
			expect(await snap.listVersions('Air Spectral Easy')).toEqual(await db.listVersions('Air Spectral Easy'));
			expect(await snap.listVersions('nope')).toEqual(await db.listVersions('nope'));
		});

		it('per-scenario lists', async () => {
			for (const id of [scenarioId, -1]) {
				expect(await snap.listScenarioRuns(id)).toEqual(await db.listScenarioRuns(id));
				expect(await snap.listHistory(id)).toEqual(await db.listHistory(id));
				expect(await snap.getSlotStats(id)).toEqual(await db.getSlotStats(id));
			}
		});

		it('per-run maps, for all ids, a subset and an unknown id', async () => {
			for (const want of [ids, ids.slice(3, 9), [ids[0]!, -1], []]) {
				expect(await snap.getScoringInputs(want)).toEqual(await db.getScoringInputs(want));
				expect(await snap.getKillDetail(want)).toEqual(await db.getKillDetail(want));
			}
		});
	});
});
