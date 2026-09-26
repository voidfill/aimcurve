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
import type { DataSource } from '../data-source';
import type { ScenarioRun } from '../run/baseline';
import type { KillDetail, SlotStats } from '../run/bots';
import type { Attempt } from '../run/queries';
import type { ScenarioVersion } from '../scenario/link';
import type { HistoryRun, Scenario } from '../scenario/queries';
import type { ScoringInput } from '../scoring';

/** Air Spectral Easy: the run About charts is one of its runs. */
export const DEMO_SCENARIO_HASH = '28c12fc03478e987f910709ce18a5cfa';

/**
 * VT Aether Intermediate S5, About's progression chart: months of runs with a
 * steady climb through several ranks.
 */
export const DEMO_PROGRESS_HASH = 'c4c11bf8a727b6e6c836138535bd0879';

/**
 * The run About charts: it led its PB-before mid-run and finished behind, the
 * clearest "where did it slip" of the set. About's copy reads the numbers from
 * the data; the `useRunCharts` test holds the shape.
 */
export const DEMO_RUN_STEM = 'Air Spectral Easy - Challenge - 2026.09.09-18.46.26';

/** The scenarios `test/fixtures/demo/` holds every completed run of. */
export const DEMO_SCENARIOS = [
	{ name: 'Air Spectral Easy', hash: DEMO_SCENARIO_HASH },
	{ name: 'VT Aether Intermediate S5', hash: DEMO_PROGRESS_HASH },
] as const;

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

export function snapshotSource(snapshot: DemoSnapshot): DataSource {
	return {
		getAttempt: async (fileStem) => snapshot.attempts[fileStem] ?? null,
		listScenarioRuns: async (scenarioId) => snapshot.scenarioRuns[scenarioId] ?? [],
		getSlotStats: async (scenarioId) => snapshot.slotStats[scenarioId] ?? [],
		getScoringInputs: async (runIds) => pick(snapshot.scoringInputs, runIds),
		getKillDetail: async (runIds) => pick(snapshot.killDetail, runIds),
		getScenario: async (hash) => snapshot.scenarios[hash] ?? null,
		listVersions: async (name) => snapshot.versions[name] ?? [],
		listHistory: async (scenarioId) => snapshot.history[scenarioId] ?? [],
	};
}
