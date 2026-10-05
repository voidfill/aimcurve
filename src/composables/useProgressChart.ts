/**
 * Everything the progression chart is drawn from (S5, S6 of the scenario page
 * design): the plotted series for the active tab, the best-so-far and median
 * lines, session breaks, dot colours, rank bands and the tooltip.
 *
 * Pure assembly over the scenario's data: the scenario page feeds it its tabs
 * and persisted axis, the About page the Overall tab by attempt.
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import type { ProgressTip } from '../components/ProgressChart.vue';
import type { Candidate } from '../lib/benchmarks/pick';
import { rankOf } from '../lib/benchmarks/rank';
import { formatScore, formatValue, timeFormat } from '../lib/run/format';
import type { BotSeries, BotTab } from '../lib/scenario/bots';
import { formatDelta, formatResult, formatSens } from '../lib/scenario/format';
import { pbSteps, rollingMedian, sessionBreaks } from '../lib/scenario/series';
import type { ScenarioData } from './useScenario';

export interface ProgressChartOptions {
	/** The bot or slot tab, or null for Overall. */
	activeTab: Ref<BotTab | null>;
	bots: Ref<BotSeries | null>;
	/** The selected benchmark, or null for no bands. */
	bench: Ref<Candidate | null>;
	/** The highlighted config group, or null. */
	group: Ref<number | null>;
	dateAxis: Ref<boolean>;
	/** `N`, the typical line's window; 10 when absent. */
	formWindow?: Ref<number>;
}

export interface ProgressChartApi {
	race: ComputedRef<boolean>;
	x: ComputedRef<number[]>;
	breaks: ComputedRef<number[]>;
	colors: ComputedRef<(string | null)[]>;
	highlight: ComputedRef<boolean[] | null>;
	/** Null while the active bot tab's values load. */
	series: ComputedRef<{ y: (number | null)[]; raw: (number | null)[] | null } | null>;
	lines: ComputedRef<{ best: (number | null)[]; median: (number | null)[]; full: boolean[] } | null>;
	ranks: ComputedRef<{ ranks: Candidate['benchmark']['ranks']; thresholds: number[]; next: number | null } | null>;
	formatY: ComputedRef<(v: number) => string>;
	tipFor: (i: number) => ProgressTip | null;
	chartLabel: ComputedRef<string>;
}

export function useProgressChart(data: Ref<ScenarioData>, options: ProgressChartOptions): ProgressChartApi {
	const { activeTab, bots, bench, group, dateAxis } = options;
	const formWindow = computed(() => options.formWindow?.value ?? 10);
	const runs = computed(() => data.value.runs);
	const kind = computed(() => data.value.kind);
	const race = computed(() => kind.value.kind === 'race');

	const x = computed(() =>
		dateAxis.value ? runs.value.map((r) => new Date(r.startedAt).getTime() / 1000) : runs.value.map((_, i) => i + 1),
	);
	const breaks = computed(() => sessionBreaks(runs.value.map((r) => r.session)));
	/** Each run's session, counted within this scenario from 1. */
	const sessionNo = computed(() => {
		const out: number[] = [];
		runs.value.forEach((r, i) => out.push(i === 0 ? 1 : out[i - 1]! + (r.session !== runs.value[i - 1]!.session ? 1 : 0)));
		return out;
	});
	const colors = computed(() => data.value.groupOf.map((g) => data.value.groups[g]?.color ?? null));
	const highlight = computed(() => (group.value === null ? null : data.value.groupOf.map((g) => g === group.value)));

	/**
	 * The series the active tab plots, on the score scale either way: the run's
	 * score, or a bot's pace. Null while bot values load.
	 */
	const series = computed(() => {
		const t = activeTab.value;
		if (t === null) return { y: runs.value.map((r) => r.score), raw: null };
		const values = bots.value?.values.get(t.key);
		const raw = bots.value?.raw.get(t.key);
		if (!values || !raw) return null;
		return { y: values, raw };
	});

	const lines = computed(() => {
		const s = series.value;
		if (s === null) return null;
		const m = rollingMedian(s.y, formWindow.value);
		return { best: pbSteps(s.y, 'higher'), median: m.value, full: m.full };
	});

	/** The best value the tab plots: the y range reaches the rank above it when near. */
	const top = computed(() => {
		let best: number | null = null;
		for (const v of series.value?.y ?? []) if (v !== null && (best === null || v > best)) best = v;
		return best;
	});

	const ranks = computed(() => {
		const c = bench.value;
		if (c === null) return null;
		const t = top.value;
		return { ranks: c.benchmark.ranks, thresholds: c.thresholds, next: t === null ? null : rankOf(c.thresholds, t).next };
	});

	function rankName(score: number): string | null {
		const c = bench.value;
		if (c === null) return null;
		const k = rankOf(c.thresholds, score).k;
		return k < 0 ? 'Unranked' : c.benchmark.ranks[k]!.name;
	}

	const formatY = computed<(v: number) => string>(() => {
		const k = kind.value;
		return k.kind === 'race' ? (v) => formatValue(k.budget - v, 1) : (v) => formatScore(v);
	});

	/** The bot table's own figure: a slot's split, or a bot's points. */
	function rawValue(v: number): string {
		return race.value ? `${formatValue(v, 2)} s` : `${formatValue(v, 1)} pts`;
	}

	function tipFor(i: number): ProgressTip | null {
		const run = runs.value[i];
		const s = series.value;
		const l = lines.value;
		if (!run || !s || !l) return null;
		const g = data.value.groups[data.value.groupOf[i]!]!;
		const rows: ProgressTip['rows'] = [];
		const t = activeTab.value;
		if (t === null) {
			if (run.score === null) rows.push({ label: 'score', value: 'none recorded' });
			else {
				rows.push({ label: race.value ? 'time' : 'score', value: formatResult(run.score, kind.value), tone: 'strong' });
				const rank = rankName(run.score);
				if (rank) rows.push({ label: 'rank', value: rank });
				if (run.pbBefore !== null) {
					const diff = run.score - run.pbBefore;
					rows.push({
						label: 'vs PB before',
						value: formatDelta(diff, kind.value),
						tone: diff > 0 ? 'ahead' : diff < 0 ? 'behind' : undefined,
					});
				} else rows.push({ label: 'vs PB before', value: 'first run' });
			}
		} else {
			const v = s.y[i];
			const raw = s.raw?.[i];
			if (v == null || raw == null) rows.push({ label: t.label, value: 'no bot detail' });
			else {
				rows.push({ label: 'pace', value: formatResult(v, kind.value), tone: 'strong' });
				const rank = rankName(v);
				if (rank) rows.push({ label: 'rank-equivalent', value: rank });
				rows.push({ label: race.value ? 'split' : 'points', value: rawValue(raw) });
			}
			const best = l.best[i];
			if (best != null) rows.push({ label: 'best pace so far', value: formatResult(best, kind.value), tone: 'base' });
		}
		const median = l.median[i];
		if (median != null) rows.push({ label: l.full[i] ? `median of last ${formWindow.value}` : 'median so far', value: formatResult(median, kind.value) });
		rows.push({ label: `config ${g.label}`, value: formatSens(g.config) });
		return {
			head: `#${i + 1} · ${timeFormat.format(new Date(run.startedAt))}`,
			sub: `session ${sessionNo.value[i]}`,
			rows,
		};
	}

	const chartLabel = computed(() =>
		activeTab.value === null
			? `${race.value ? 'Time' : 'Score'} of every completed run`
			: `Pace on ${activeTab.value.label} in every completed run`,
	);

	return { race, x, breaks, colors, highlight, series, lines, ranks, formatY, tipFor, chartLabel };
}
