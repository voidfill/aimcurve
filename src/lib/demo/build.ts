/**
 * Builds the demo snapshot from a database holding the demo fixtures, through
 * the same queries the app runs. Only the snapshot test calls this; the About
 * page loads its committed output.
 *
 * The charted demo scenarios get everything their charts read; the benchmark
 * beat's other scenarios only their rows and history, all ARC reads.
 */
import type { PGliteInterface } from '@electric-sql/pglite';
import { pgSource } from '../data-source';
import { DEMO_SCENARIOS, type DemoSnapshot } from './snapshot';

export async function buildSnapshot(pg: PGliteInterface): Promise<DemoSnapshot> {
	const db = pgSource(pg);
	const snapshot: DemoSnapshot = {
		attempts: {},
		scoringInputs: {},
		killDetail: {},
		scenarioRuns: {},
		slotStats: {},
		history: {},
		scenarios: {},
		versions: {},
	};
	const hashes = await pg.query<{ hash: string }>('select hash from scenario order by hash');
	for (const { hash } of hashes.rows) {
		const scenario = (await db.getScenario(hash))!;
		const runs = await db.listScenarioRuns(scenario.id);
		if (runs.length === 0) continue;
		const ids = runs.map((r) => r.id);
		snapshot.scenarios[hash] = scenario;
		snapshot.history[scenario.id] = await db.listHistory(scenario.id);
		if (!DEMO_SCENARIOS.some((s) => s.hash === hash)) continue;
		snapshot.versions[scenario.name] = await db.listVersions(scenario.name);
		snapshot.scenarioRuns[scenario.id] = runs;
		snapshot.slotStats[scenario.id] = await db.getSlotStats(scenario.id);
		for (const run of runs) snapshot.attempts[run.fileStem] = (await db.getAttempt(run.fileStem))!;
		for (const [id, input] of await db.getScoringInputs(ids)) snapshot.scoringInputs[id] = input;
		for (const [id, kills] of await db.getKillDetail(ids)) snapshot.killDetail[id] = kills;
	}
	return snapshot;
}
