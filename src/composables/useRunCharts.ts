/**
 * Everything the unified chart and the bot table are drawn from, for one
 * analysed run (Run view R3–R7): the chart data, the exact readout, the bot
 * encounters and their colours, the bot table, the rank bands, and the bot
 * highlight the table and chart share.
 *
 * Pure assembly over an analysis: the Run view feeds it its persisted
 * settings, the About page fixed ones.
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { BotTableData } from '../components/BotTable.vue';
import type { ChartLayers, ChartRanks } from '../components/UnifiedChart.vue';
import { type Baseline, flatReadout } from '../lib/run/baseline';
import {
	bestSplits,
	botColors,
	clockRows,
	type Encounter,
	type Engagement,
	encounters,
	engagements,
	isClicking,
	raceRows,
} from '../lib/run/bots';
import { type ChartBaseline, type ChartData, chartData } from '../lib/run/chart-data';
import { atX, killTimes, paceFor, readout, recentRange, type RunCurve } from '../lib/scoring';
import type { BenchmarkRankApi } from './useBenchmarkRank';
import type { Analysis } from './useRunAnalysis';

export interface RunChartsOptions {
	layers: Ref<ChartLayers>;
	/** Local-pace window, seconds. */
	window: Ref<1 | 3 | 5>;
}

export interface RunChartsApi {
	current: ComputedRef<RunCurve | null>;
	race: ComputedRef<boolean>;
	/** A race's budget in seconds, else null. */
	budget: ComputedRef<number | null>;
	chart: ComputedRef<ChartData | null>;
	layers: ComputedRef<ChartLayers>;
	chartBaseline: ComputedRef<{ kind: 'charted' | 'flat'; label: string; score: number } | null>;
	chartRanks: ComputedRef<ChartRanks | null>;
	readoutAt: ComputedRef<((x: number) => number) | null>;
	timeAt: ComputedRef<(x: number) => number>;
	spans: ComputedRef<Encounter[]>;
	colors: ComputedRef<Map<string, string>>;
	table: ComputedRef<BotTableData | null>;
	/** The hovered bot-table row's key, which wins over the pinned one. */
	hovered: Ref<string | null>;
	pinned: Ref<string | null>;
	highlight: ComputedRef<Encounter[] | null>;
	/** The pinned row's encounters alone, which the chart zooms to; null when none is pinned. */
	pinnedSpans: ComputedRef<Encounter[] | null>;
	/** Pins a row, or unpins it when it is already pinned. */
	toggle: (key: string) => void;
}

export function useRunCharts(
	analysis: Ref<Analysis | null>,
	baseline: Ref<Baseline | null>,
	bench: BenchmarkRankApi,
	options: RunChartsOptions,
): RunChartsApi {
	/** The selected ladder and the run's next rank, for the chart's rank layer (B7). */
	const chartRanks = computed<ChartRanks | null>(() => {
		const c = bench.selected.value;
		const r = bench.rank.value;
		if (c === null) return null;
		return { ranks: c.benchmark.ranks, thresholds: c.thresholds, next: r?.next ?? null };
	});

	const current = computed(() => analysis.value?.current ?? null);
	const race = computed(() => current.value?.params.kind === 'race');
	const budget = computed(() => (current.value?.params.kind === 'race' ? current.value.params.budget : null));

	/** The baseline's curve when it is charted, for everything drawn against it. */
	const baseCurve = computed<RunCurve | null>(() => (baseline.value?.kind === 'charted' ? baseline.value.curve : null));

	const chart = computed(() => {
		const cur = current.value;
		const a = analysis.value;
		const b = baseline.value;
		if (!cur || !a || !b) return null;
		const w = options.window.value;
		const base: ChartBaseline =
			b.kind === 'charted'
				? { kind: 'charted', curve: b.curve, pace: paceFor(b.curve, w) }
				: b.kind === 'flat'
					? { kind: 'flat', score: b.score }
					: { kind: 'none' };
		const recent = a.recent.length > 0 ? recentRange(cur, a.recent) : null;
		return chartData(cur, paceFor(cur, w), base, recent);
	});

	/**
	 * When each killed bot of a loaded run was engaged, from its kill times and
	 * TTK. None in a click scenario: there, the time between kills is aiming at no
	 * bot in particular, so neither the chart spans nor the table are drawn.
	 */
	function engagedOf(stem: string): Engagement[] {
		const a = analysis.value;
		const kills = a?.killsOf(stem);
		const input = a?.inputOf(stem);
		if (!kills || !input || isClicking(kills)) return [];
		return engagements(kills, killTimes(input), a!.window);
	}

	const engaged = computed<Engagement[]>(() => (current.value ? engagedOf(current.value.fileStem) : []));
	const spans = computed<Encounter[]>(() => (current.value ? encounters(current.value, engaged.value) : []));
	const colors = computed(() => botColors(spans.value.map((e) => e.bot)));

	const table = computed<BotTableData | null>(() => {
		const cur = current.value;
		const a = analysis.value;
		if (!cur || !a || spans.value.length === 0) return null;
		const base = baseCurve.value;
		if (cur.params.kind === 'race') {
			const runs = [...a.raceCandidates, cur].map((c) => engagedOf(c.fileStem));
			const best = bestSplits(runs, cur.params.bots);
			return { kind: 'race', table: raceRows(engaged.value, base ? engagedOf(base.fileStem) : null, best) };
		}
		const kills = a.killsOf(cur.fileStem)!;
		const baseEngaged = base ? { curve: base, engaged: engagedOf(base.fileStem) } : null;
		return { kind: 'clock', table: clockRows(cur, engaged.value, kills, baseEngaged) };
	});

	const chartBaseline = computed(() => {
		const b = baseline.value;
		return b && b.kind !== 'none' ? { kind: b.kind, label: b.label, score: b.score } : null;
	});

	const readoutAt = computed<((x: number) => number) | null>(() => {
		const cur = current.value;
		const b = baseline.value;
		if (!cur || !b || b.kind === 'none') return null;
		if (b.kind === 'flat') return (x) => flatReadout(cur, b.score, x);
		return (x) => readout(cur, b.curve, x).value;
	});

	/** This run's elapsed time at progress `x`, for the tooltip. */
	const timeAt = computed(() => {
		const cur = current.value;
		return (x: number) => (cur ? atX(cur, x).t : 0);
	});

	const layers = computed<ChartLayers>(() => ({ ...options.layers.value }));

	/* Bot highlight: hover wins over the pinned row. A different run starts clear. */
	const hovered = ref<string | null>(null);
	const pinned = ref<string | null>(null);
	watch(
		() => analysis.value?.inspected.fileStem,
		() => {
			hovered.value = null;
			pinned.value = null;
		},
	);

	function spansOf(key: string | null): Encounter[] | null {
		if (key === null) return null;
		return race.value ? spans.value.filter((e) => String(e.index) === key) : spans.value.filter((e) => e.bot === key);
	}

	const highlight = computed(() => spansOf(hovered.value ?? pinned.value));
	const pinnedSpans = computed(() => spansOf(pinned.value));

	function toggle(key: string): void {
		pinned.value = pinned.value === key ? null : key;
	}

	return {
		current,
		race,
		budget,
		chart,
		layers,
		chartBaseline,
		chartRanks,
		readoutAt,
		timeAt,
		spans,
		colors,
		table,
		hovered,
		pinned,
		highlight,
		pinnedSpans,
		toggle,
	};
}
