/**
 * The queries the analysis composables read through, without the database
 * handle. The app answers them from PGlite (`pgSource`); the About page answers
 * them from a bundled snapshot (`snapshotSource` in `lib/demo`), so its charts
 * render without opening the database.
 *
 * Only what `useRunAnalysis` and `useScenario` need is here. Everything else
 * stays a plain query over `pg`.
 */
import type { PGliteInterface } from '@electric-sql/pglite';
import type { ScenarioRun } from './run/baseline';
import type { KillDetail, SlotStats } from './run/bots';
import { type Attempt, getAttempt, getKillDetail, getScoringInputs, getSlotStats, listScenarioRuns } from './run/queries';
import type { ScenarioVersion } from './scenario/link';
import { getScenario, type HistoryRun, listHistory, listVersions, type Scenario } from './scenario/queries';
import type { ScoringInput } from './scoring';

export interface DataSource {
	getAttempt(fileStem: string): Promise<Attempt | null>;
	listScenarioRuns(scenarioId: number): Promise<ScenarioRun[]>;
	getSlotStats(scenarioId: number): Promise<SlotStats[]>;
	getScoringInputs(runIds: number[]): Promise<Map<number, ScoringInput>>;
	getKillDetail(runIds: number[]): Promise<Map<number, KillDetail>>;
	getScenario(hash: string): Promise<Scenario | null>;
	listVersions(name: string): Promise<ScenarioVersion[]>;
	listHistory(scenarioId: number): Promise<HistoryRun[]>;
}

export function pgSource(pg: PGliteInterface): DataSource {
	return {
		getAttempt: (fileStem) => getAttempt(pg, fileStem),
		listScenarioRuns: (scenarioId) => listScenarioRuns(pg, scenarioId),
		getSlotStats: (scenarioId) => getSlotStats(pg, scenarioId),
		getScoringInputs: (runIds) => getScoringInputs(pg, runIds),
		getKillDetail: (runIds) => getKillDetail(pg, runIds),
		getScenario: (hash) => getScenario(pg, hash),
		listVersions: (name) => listVersions(pg, name),
		listHistory: (scenarioId) => listHistory(pg, scenarioId),
	};
}
