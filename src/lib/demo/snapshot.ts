/**
 * The About page's sample data: every answer its charts query, precomputed
 * from the demo fixtures and keyed by the query's own key, so the About page
 * renders real charts without opening the database.
 *
 * It is not a recording of calls. `useRunAnalysis` fetches curves in batches
 * that depend on the data, so a source that only replayed the calls it once
 * saw would break whenever that walk changed. Each method here instead looks
 * its key up, exactly like the SQL's equality or `= any(…)` filter.
 *
 * Must not import from `src/db/`: this is what keeps PGlite out of About.
 */
import type { Snapshot } from '../benchmarks/snapshot';
import type { DataSource } from '../data-source';
import type { StreamRows } from '../arc/history';
import type { ScenarioRun } from '../run/baseline';
import type { KillDetail, SlotStats } from '../run/bots';
import type { Attempt } from '../run/queries';
import type { ScenarioVersion } from '../scenario/link';
import type { HistoryRun, Scenario } from '../scenario/queries';
import type { ScoringInput } from '../scoring';

/** Air Spectral Easy: the run About charts is one of its runs. */
export const DEMO_SCENARIO_HASH = '28c12fc03478e987f910709ce18a5cfa';

/**
 * The run About charts: it led its PB-before mid-run and finished behind, the
 * clearest "where did it slip" of the set. About's copy reads the numbers from
 * the data; the `useRunCharts` test holds the shape.
 */
export const DEMO_RUN_STEM = 'Air Spectral Easy - Challenge - 2026.09.09-18.46.26';

/** The scenarios About charts run by run: `test/fixtures/demo/` holds every completed run of them, with perfs. */
export const DEMO_SCENARIOS = [
	{ name: 'Air Spectral Easy', hash: DEMO_SCENARIO_HASH },
] as const;

/**
 * About's benchmark beat: Viscose Benchmarks S2 Medium, shown as one category,
 * Reactive Tracking: six scenarios with months of runs, small enough to read
 * at once. Its scenarios' fixtures are CSVs only, since ARC needs only scores.
 */
export const DEMO_BENCHMARK_ID = 2336;
export const DEMO_CATEGORY = 'Reactive Tracking';

/** The trimmed scenario names of the demo category, from the benchmark snapshot. */
export function demoCategoryNames(benchmarks: Snapshot): string[] {
	const tree = benchmarks.benchmarks.find((b) => b.id === DEMO_BENCHMARK_ID)?.tree ?? null;
	const category = tree?.find((c) => c.name === DEMO_CATEGORY);
	if (!category) throw new Error(`benchmark ${DEMO_BENCHMARK_ID} has no category ${DEMO_CATEGORY}`);
	return [...new Set(category.subs.flatMap((s) => s.scenarios.map((n) => n.trim())))];
}

/** JSON-shaped: object keys are strings, so ids are too. */
export interface DemoSnapshot {
	attempts: Record<string, Attempt>;
	scoringInputs: Record<string, ScoringInput>;
	killDetail: Record<string, KillDetail>;
	scenarioRuns: Record<string, ScenarioRun[]>;
	slotStats: Record<string, SlotStats[]>;
	history: Record<string, HistoryRun[]>;
	scenarios: Record<string, Scenario>;
	versions: Record<string, ScenarioVersion[]>;
}

function pick<T>(table: Record<string, T>, ids: number[]): Map<number, T> {
	const out = new Map<number, T>();
	for (const id of ids) {
		const row = table[id];
		if (row !== undefined) out.set(id, row);
	}
	return out;
}

/** The ARC run stream from the bundled history, as `listArcRuns` reads it from the database. */
function arcRuns(snapshot: DemoSnapshot, names: readonly string[]): StreamRows {
	const wanted = new Set(names);
	const scenarios = Object.values(snapshot.scenarios)
		.map((s) => ({ id: s.id, name: s.name.trim(), hash: s.hash }))
		.filter((s) => wanted.has(s.name));
	const runs = scenarios
		.flatMap((s) => (snapshot.history[s.id] ?? []).filter((r) => r.score !== null).map((r) => ({ scenario: s.id, run: r })))
		.sort((a, b) => (a.run.startedAt < b.run.startedAt ? -1 : a.run.startedAt > b.run.startedAt ? 1 : a.run.id - b.run.id));
	return {
		scenarios,
		scenarioId: Int32Array.from(runs.map((r) => r.scenario)),
		runId: Int32Array.from(runs.map((r) => r.run.id)),
		t: Float64Array.from(runs.map((r) => new Date(r.run.startedAt).getTime())),
		score: Float64Array.from(runs.map((r) => r.run.score!)),
	};
}

export function snapshotSource(snapshot: DemoSnapshot): DataSource {
	const scenarioOf = (runId: number) => {
		for (const s of Object.values(snapshot.scenarios)) {
			const run = snapshot.history[s.id]?.find((r) => r.id === runId);
			if (run) return { fileStem: run.fileStem, hash: s.hash };
		}
		return null;
	};
	return {
		getAttempt: async (fileStem) => snapshot.attempts[fileStem] ?? null,
		listScenarioRuns: async (scenarioId) => snapshot.scenarioRuns[scenarioId] ?? [],
		getSlotStats: async (scenarioId) => snapshot.slotStats[scenarioId] ?? [],
		getScoringInputs: async (runIds) => pick(snapshot.scoringInputs, runIds),
		getKillDetail: async (runIds) => pick(snapshot.killDetail, runIds),
		getScenario: async (hash) => snapshot.scenarios[hash] ?? null,
		listVersions: async (name) => snapshot.versions[name] ?? [],
		listHistory: async (scenarioId) => snapshot.history[scenarioId] ?? [],
		listArcRuns: async (names) => arcRuns(snapshot, names),
		listPlayedNames: async () =>
			new Set(
				Object.values(snapshot.scenarios)
					.filter((s) => (snapshot.history[s.id] ?? []).some((r) => r.score !== null))
					.map((s) => s.name.trim()),
			),
		getRunLink: async (runId) => scenarioOf(runId),
	};
}
