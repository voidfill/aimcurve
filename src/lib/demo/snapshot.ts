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

/** Air Spectral Easy, the scenario the demo fixtures are all of. */
export const DEMO_SCENARIO_HASH = '28c12fc03478e987f910709ce18a5cfa';

/**
 * The run About charts: it led its PB-before by 2.2 points at the halfway mark
 * and finished 3.3 behind, the clearest "where did it slip" of the set.
 */
export const DEMO_RUN_STEM = 'Air Spectral Easy - Challenge - 2026.09.09-18.46.26';

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
