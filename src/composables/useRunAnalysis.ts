/**
 * The inspected run's analysis: its curve, the baseline for every option, the
 * recent set, and the bot detail. See docs/superpowers/specs/2026-09-24-run-view-design.md (R8).
 *
 * Loading settles every baseline option at once, so switching the option in the
 * chart header re-resolves synchronously and never refetches. Curves are
 * memoised by file stem in the scoring model; inputs and kill detail are cached
 * here for the lifetime of the view.
 */
import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import { useStorage } from '@vueuse/core';
import type { PGliteInterface } from '@electric-sql/pglite';
import {
	type Baseline,
	type BaselineOption,
	type CurveOf,
	pbRun,
	recentRuns,
	resolveBaseline,
	type ScenarioRun,
	walkOrder,
} from '../lib/run/baseline';
import { fixedWindow, type KillDetail } from '../lib/run/bots';
import { type Attempt, getKillDetail, getScoringInputs, getSlotStats, listScenarioRuns } from '../lib/run/queries';
import { classify, comparable, curveFor, type RunCurve, type ScoringInput } from '../lib/scoring';
import { useDb } from './useDb';
import { useImport } from './useImport';

export interface ChartSettings {
	local: boolean;
	accumulated: boolean;
	baseline: boolean;
	baseLocal: boolean;
	recent: boolean;
	/** Benchmark rank bands (B7 of the benchmark ranks design). */
	ranks: boolean;
	option: BaselineOption;
	/** Local-pace window, seconds. */
	window: 1 | 3 | 5;
}

const DEFAULTS: ChartSettings = {
	local: true,
	accumulated: true,
	baseline: true,
	baseLocal: false,
	recent: false,
	ranks: true,
	option: 'pb-before',
	window: 5,
};

/** One key for every chart display choice, persisted per browser. */
export function useChartSettings(): Ref<ChartSettings> {
	return useStorage<ChartSettings>('aimcurve.run-chart', { ...DEFAULTS }, localStorage, { mergeDefaults: true });
}

export type AnalysisState = 'idle' | 'loading' | 'ready' | 'error';

/** Why the inspected run has no curve. */
export type NoCurve = { reason: 'no-perf' } | { reason: 'unsupported'; detail: string };

export interface Analysis {
	inspected: ScenarioRun;
	runs: ScenarioRun[];
	input: ScoringInput | null;
	current: RunCurve | null;
	noCurve: NoCurve | null;
	curveOf: CurveOf;
	inputOf: (stem: string) => ScoringInput | undefined;
	killsOf: (stem: string) => KillDetail | null;
	recent: RunCurve[];
	/** Every comparable curve of the scenario, for the race *best* column; empty for clock. */
	raceCandidates: RunCurve[];
	/** A fixed-window scenario's live window in seconds, else null. */
	window: number | null;
}

export interface RunAnalysisApi {
	state: Ref<AnalysisState>;
	error: Ref<string | null>;
	analysis: Ref<Analysis | null>;
	baseline: ComputedRef<Baseline | null>;
	settings: Ref<ChartSettings>;
	retry: () => void;
}

const BATCH = 20;
const RECENT = 10;

const UNSUPPORTED: Record<string, string> = {
	'signals-disagree': 'its race signals disagree',
	'no-score-series': 'its performance file has no score series',
	'bad-time-limit': 'its time limit is missing or out of range',
	'no-race-pool': 'it looks like a race but has no damage pool',
	'bad-kill-times': 'its kill times are out of order',
};

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

class Loader {
	readonly inputs = new Map<string, ScoringInput | null>();
	readonly kills = new Map<string, KillDetail | null>();

	constructor(
		private readonly pg: PGliteInterface,
		private readonly runs: readonly ScenarioRun[],
	) {}

	/** Loads scoring inputs and kill detail for the runs not loaded yet. */
	async load(runs: readonly ScenarioRun[]): Promise<void> {
		const missing = runs.filter((run) => run.hasPerf && !this.inputs.has(run.fileStem));
		if (missing.length === 0) return;
		const ids = missing.map((run) => run.id);
		const [inputs, kills] = await Promise.all([getScoringInputs(this.pg, ids), getKillDetail(this.pg, ids)]);
		for (const run of missing) {
			this.inputs.set(run.fileStem, inputs.get(run.id) ?? null);
			this.kills.set(run.fileStem, kills.get(run.id) ?? null);
		}
	}

	curveOf: CurveOf = (stem) => {
		if (!this.inputs.has(stem)) return undefined;
		const input = this.inputs.get(stem);
		return input ? curveFor(input) : null;
	};

	/** Walks `order` in batches until `enough` holds or it runs out. */
	async walk(order: readonly ScenarioRun[], enough: () => boolean): Promise<void> {
		for (let i = 0; i < order.length && !enough(); i += BATCH) await this.load(order.slice(i, i + BATCH));
	}

	allPerf(): ScenarioRun[] {
		return this.runs.filter((run) => run.hasPerf);
	}
}

export function useRunAnalysis(selected: Ref<Attempt | null>): RunAnalysisApi {
	const { pg } = useDb();
	const { revision } = useImport();
	const settings = useChartSettings();

	const state = ref<AnalysisState>('idle');
	const error = ref<string | null>(null);
	const analysis = shallowRef<Analysis | null>(null);
	let gen = 0;

	async function run(attempt: Attempt | null): Promise<void> {
		const handle = pg.value;
		const mine = ++gen;
		if (attempt === null || handle === null) {
			analysis.value = null;
			state.value = 'idle';
			return;
		}
		// Keep showing the previous analysis of the same run while an import
		// re-runs this; a different run starts from a clean slate.
		if (analysis.value?.inspected.fileStem !== attempt.fileStem) {
			analysis.value = null;
			state.value = 'loading';
		}
		try {
			const [runs, slots] = await Promise.all([
				listScenarioRuns(handle, attempt.scenarioId),
				getSlotStats(handle, attempt.scenarioId),
			]);
			if (mine !== gen) return;
			const inspected = runs.find((r) => r.fileStem === attempt.fileStem) ?? {
				id: attempt.id,
				fileStem: attempt.fileStem,
				score: attempt.score,
				startedAt: attempt.startedAt,
				hasPerf: attempt.hasPerf,
			};
			const loader = new Loader(handle, runs);

			// The inspected run and the two PB runs are known from metadata alone.
			const pbs = [pbRun('pb-before', inspected, runs), pbRun('pb', inspected, runs)].filter(
				(r): r is ScenarioRun & { score: number } => r !== null,
			);
			await loader.load([inspected, ...pbs]);
			if (mine !== gen) return;

			const input = loader.inputs.get(inspected.fileStem) ?? null;
			const current = input ? curveFor(input) : null;
			const candidate = (stem: string) => {
				const curve = loader.curveOf(stem);
				return curve != null && (current === null || comparable(current.params, curve.params));
			};

			const best = walkOrder('best-charted', inspected, runs);
			const recent = walkOrder('recent', inspected, runs);
			await loader.walk(best, () => best.some((r) => candidate(r.fileStem)));
			await loader.walk(recent, () => recent.filter((r) => candidate(r.fileStem)).length >= RECENT);
			if (current?.params.kind === 'race') await loader.load(loader.allPerf());
			if (mine !== gen) return;

			let noCurve: NoCurve | null = null;
			if (!attempt.hasPerf || input === null) noCurve = { reason: 'no-perf' };
			else if (current === null) {
				const params = classify(input);
				noCurve = {
					reason: 'unsupported',
					detail: params.kind === 'unsupported' ? (UNSUPPORTED[params.reason] ?? params.reason) : 'it has no curve',
				};
			}

			const raceCandidates =
				current?.params.kind === 'race'
					? loader
							.allPerf()
							.map((r) => loader.curveOf(r.fileStem))
							.filter((c): c is RunCurve => c != null && comparable(current.params, c.params))
					: [];

			analysis.value = {
				inspected,
				runs,
				input,
				current,
				noCurve,
				curveOf: loader.curveOf,
				inputOf: (stem) => loader.inputs.get(stem) ?? undefined,
				killsOf: (stem) => loader.kills.get(stem) ?? null,
				recent: recentRuns(inspected, runs, current, loader.curveOf, RECENT),
				raceCandidates,
				window: fixedWindow(slots),
			};
			state.value = 'ready';
			error.value = null;
		} catch (err) {
			if (mine !== gen) return;
			error.value = errorText(err);
			state.value = 'error';
		}
	}

	watch([selected, pg, revision], () => void run(selected.value), { immediate: true });

	const baseline = computed<Baseline | null>(() => {
		const a = analysis.value;
		if (a === null) return null;
		return resolveBaseline(settings.value.option, a.inspected, a.runs, a.current, a.curveOf);
	});

	return { state, error, analysis, baseline, settings, retry: () => void run(selected.value) };
}
