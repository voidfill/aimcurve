/**
 * The scenario page's data (S8 of the scenario page design).
 * See docs/superpowers/specs/2026-09-25-scenario-page-design.md.
 *
 * Loading reads the scenario, its versions and its completed runs, plus the
 * few latest perf-backed runs: the newest of them decides the run kind (race
 * or clock) and the bot tabs. Bot values for every run wait for `loadBots`,
 * which the page calls when a bot tab is first opened (S6). An import that
 * adds runs reloads everything, bot values included once they were asked for.
 */
import { ref, shallowRef, watch, type Ref } from 'vue';
import { fixedWindow, type KillDetail } from '../lib/run/bots';
import { getKillDetail, getScoringInputs, getSlotStats } from '../lib/run/queries';
import { type BotSeries, type BotTabs, botSeries, botTabs } from '../lib/scenario/bots';
import { type ConfigGroup, configGroups } from '../lib/scenario/config';
import type { ResultKind } from '../lib/scenario/format';
import type { ScenarioVersion } from '../lib/scenario/link';
import { getScenario, type HistoryRun, listHistory, listVersions, type Scenario } from '../lib/scenario/queries';
import { curveFor, type ScoringInput } from '../lib/scoring';
import { useDb } from './useDb';
import { useImport } from './useImport';

export type ScenarioState = 'loading' | 'ready' | 'missing' | 'error';
export type BotState = 'idle' | 'loading' | 'ready' | 'error';

export interface ScenarioData {
	scenario: Scenario;
	versions: ScenarioVersion[];
	/** Completed runs, oldest first. */
	runs: HistoryRun[];
	groups: ConfigGroup[];
	/** Each run's index into `groups`. */
	groupOf: number[];
	kind: ResultKind;
	/** Null for a click scenario or when no run has kill detail. */
	tabs: BotTabs | null;
}

export interface ScenarioApi {
	state: Ref<ScenarioState>;
	error: Ref<string | null>;
	data: Ref<ScenarioData | null>;
	botState: Ref<BotState>;
	botError: Ref<string | null>;
	bots: Ref<BotSeries | null>;
	/** Loads bot values for every run, once; later calls reuse them. */
	loadBots: () => void;
	retry: () => void;
}

/** How many of the latest perf-backed runs are read to find the reference run. */
const REFERENCE_LOOKBACK = 5;

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function useScenario(hash: Ref<string>): ScenarioApi {
	const { pg } = useDb();
	const { revision } = useImport();

	const state = ref<ScenarioState>('loading');
	const error = ref<string | null>(null);
	const data = shallowRef<ScenarioData | null>(null);
	const botState = ref<BotState>('idle');
	const botError = ref<string | null>(null);
	const bots = shallowRef<BotSeries | null>(null);

	let window: number | null = null;
	let gen = 0;
	let botGen = 0;
	let botsWanted = false;

	async function load(): Promise<void> {
		const handle = pg.value;
		const mine = ++gen;
		if (handle === null) return;
		// A different scenario starts from a clean slate; an import keeps showing
		// the current one while it reloads.
		if (data.value?.scenario.hash !== hash.value) {
			data.value = null;
			state.value = 'loading';
			bots.value = null;
			botState.value = 'idle';
			botsWanted = false;
		}
		try {
			const scenario = await getScenario(handle, hash.value);
			if (mine !== gen) return;
			if (scenario === null) {
				data.value = null;
				state.value = 'missing';
				return;
			}
			const [runs, versions, slots] = await Promise.all([
				listHistory(handle, scenario.id),
				listVersions(handle, scenario.name),
				getSlotStats(handle, scenario.id),
			]);
			if (mine !== gen) return;
			if (runs.length === 0) {
				data.value = null;
				state.value = 'missing';
				return;
			}
			window = fixedWindow(slots);

			const latest = runs.filter((r) => r.hasPerf).slice(-REFERENCE_LOOKBACK).reverse();
			const ids = latest.map((r) => r.id);
			const [inputs, kills] = ids.length
				? await Promise.all([getScoringInputs(handle, ids), getKillDetail(handle, ids)])
				: [new Map<number, ScoringInput>(), new Map<number, KillDetail>()];
			if (mine !== gen) return;

			let kind: ResultKind = { kind: 'unknown' };
			for (const run of latest) {
				const input = inputs.get(run.id);
				const curve = input ? curveFor(input) : null;
				if (curve) {
					kind = curve.params.kind === 'race' ? { kind: 'race', budget: curve.params.budget } : { kind: 'clock' };
					break;
				}
			}
			const reference = latest.find((r) => inputs.has(r.id) && kills.has(r.id));
			const tabs = reference ? botTabs(inputs.get(reference.id)!, kills.get(reference.id)!, window) : null;

			const { groups, groupOf } = configGroups(runs);
			data.value = { scenario, versions, runs, groups, groupOf, kind, tabs };
			state.value = 'ready';
			error.value = null;
			if (botsWanted) void computeBots();
		} catch (err) {
			if (mine !== gen) return;
			error.value = errorText(err);
			state.value = 'error';
		}
	}

	async function computeBots(): Promise<void> {
		const handle = pg.value;
		const d = data.value;
		const mine = ++botGen;
		if (handle === null || d === null || d.tabs === null) return;
		if (bots.value === null) botState.value = 'loading';
		try {
			const ids = d.runs.filter((r) => r.hasPerf).map((r) => r.id);
			const [inputs, kills] = await Promise.all([getScoringInputs(handle, ids), getKillDetail(handle, ids)]);
			if (mine !== botGen || data.value !== d) return;
			const idOf = new Map(d.runs.map((r) => [r.fileStem, r.id]));
			bots.value = botSeries(
				d.runs.map((r) => r.fileStem),
				d.tabs,
				(stem) => inputs.get(idOf.get(stem)!),
				(stem) => kills.get(idOf.get(stem)!),
				window,
			);
			botState.value = 'ready';
			botError.value = null;
		} catch (err) {
			if (mine !== botGen) return;
			botError.value = errorText(err);
			botState.value = 'error';
		}
	}

	function loadBots(): void {
		botsWanted = true;
		if (botState.value === 'idle' || botState.value === 'error') void computeBots();
	}

	watch([hash, pg, revision], () => void load(), { immediate: true });

	return {
		state,
		error,
		data,
		botState,
		botError,
		bots,
		loadBots,
		retry: () => {
			void load();
			if (botState.value === 'error') void computeBots();
		},
	};
}
