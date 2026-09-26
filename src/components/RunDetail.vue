<script setup lang="ts">
/**
 * One inspected run, fully analysed: header, stats, the unified chart and the
 * bot breakdown, all against one baseline (Run view R1, R2).
 *
 * On first mount the header and stats render from the attempt straight away
 * and the chart and table wait for the analysis. A later switch holds the
 * previous run until the next is analysed. A failure leaves the header in place.
 */
import { computed, ref, shallowRef, toRef, watch } from 'vue';
import ChartControls from './ChartControls.vue';
import BotTable, { type BotTableData } from './BotTable.vue';
import RunHeader from './RunHeader.vue';
import StatsStrip from './StatsStrip.vue';
import UnifiedChart, { type ChartLayers, type ChartRanks } from './UnifiedChart.vue';
import { useBenchmarkRank } from '../composables/useBenchmarkRank';
import { useRunAnalysis, type ChartSettings } from '../composables/useRunAnalysis';
import { flatReadout } from '../lib/run/baseline';
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
import { type ChartBaseline, chartData } from '../lib/run/chart-data';
import { formatScore, formatSigned, formatValue } from '../lib/run/format';
import type { Attempt } from '../lib/run/queries';
import { atX, killTimes, paceFor, readout, recentRange, type RunCurve } from '../lib/scoring';

const props = defineProps<{ attempt: Attempt }>();

const {
	state,
	error,
	analysis: latest,
	baseline: latestBaseline,
	settings,
	retry,
} = useRunAnalysis(toRef(props, 'attempt'));

/**
 * The attempt on screen. Switching runs keeps the previous one, header, chart
 * and table together, until the new one's analysis is ready (or has failed),
 * then swaps everything in one frame. Blanking the page in between would flash
 * a loading line and collapse the chart for a few dozen milliseconds.
 */
const shown = shallowRef(props.attempt);
watch([() => props.attempt, state, latest], ([attempt]) => {
	const same = attempt.fileStem === shown.value.fileStem;
	const settled = state.value === 'error' || latest.value?.inspected.fileStem === attempt.fileStem;
	if (same || settled) shown.value = attempt;
});
const stale = computed(() => shown.value.fileStem !== props.attempt.fileStem);

/** The analysis of the attempt on screen; null while its first one loads or after a failure. */
const analysis = computed(() => (latest.value?.inspected.fileStem === shown.value.fileStem ? latest.value : null));
const baseline = computed(() => (analysis.value === null ? null : latestBaseline.value));

const bench = useBenchmarkRank(
	computed(() => shown.value.scenarioName),
	computed(() => shown.value.score),
);

/** The selected ladder and the run's next rank, for the chart's rank layer (B7). */
const chartRanks = computed<ChartRanks | null>(() => {
	const c = bench.selected.value;
	const r = bench.rank.value;
	if (c === null) return null;
	return { ranks: c.benchmark.ranks, thresholds: c.thresholds, next: r?.next ?? null };
});

const ranksDisabled = computed(() =>
	bench.candidates.value.length === 0
		? 'This scenario is in no known benchmark'
		: bench.selected.value === null
			? 'No benchmark is selected'
			: null,
);

const current = computed(() => analysis.value?.current ?? null);
const race = computed(() => current.value?.params.kind === 'race');
const budget = computed(() => (current.value?.params.kind === 'race' ? current.value.params.budget : null));

function update(patch: Partial<ChartSettings>): void {
	settings.value = { ...settings.value, ...patch };
}

/** The baseline's curve when it is charted, for everything drawn against it. */
const baseCurve = computed<RunCurve | null>(() => (baseline.value?.kind === 'charted' ? baseline.value.curve : null));

const chart = computed(() => {
	const cur = current.value;
	const a = analysis.value;
	const b = baseline.value;
	if (!cur || !a || !b) return null;
	const w = settings.value.window;
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

const layers = computed<ChartLayers>(() => ({
	local: settings.value.local,
	accumulated: settings.value.accumulated,
	baseline: settings.value.baseline,
	baseLocal: settings.value.baseLocal,
	recent: settings.value.recent,
	ranks: settings.value.ranks,
}));

/* Bot highlight: hover wins over the pinned row. */
const hovered = ref<string | null>(null);
const pinned = ref<string | null>(null);
watch(
	() => shown.value.fileStem,
	() => {
		hovered.value = null;
		pinned.value = null;
	},
);

const highlight = computed<Encounter[] | null>(() => {
	const key = hovered.value ?? pinned.value;
	if (key === null) return null;
	return race.value ? spans.value.filter((e) => String(e.index) === key) : spans.value.filter((e) => e.bot === key);
});

function toggle(key: string): void {
	pinned.value = pinned.value === key ? null : key;
}

/** R7 at rest: the final accumulated values and the exact difference. */
const footer = computed(() => {
	const b = baseline.value;
	const score = shown.value.score;
	if (!b || b.kind === 'none' || score === null) return null;
	const digits = race.value ? 2 : 1;
	const fmt = (s: number) => (budget.value === null ? formatScore(s) : `${formatValue(budget.value - s, 2)} s`);
	const diff = score - b.score;
	return {
		text: `final ${fmt(score)} vs ${b.label} ${fmt(b.score)} · ${formatSigned(diff, digits)} ${race.value ? 's' : 'pts'}`,
		tone: diff > 0 ? 'ahead' : diff < 0 ? 'behind' : '',
	};
});

const noKills = computed(() => current.value !== null && current.value.params.kind === 'clock' && spans.value.length === 0);
</script>

<template>
	<div class="detail" :class="{ stale }" :aria-busy="stale">
		<RunHeader
			:attempt="shown"
			:current="current"
			:baseline="baseline"
			:candidates="bench.candidates.value"
			:selected="bench.selected.value"
			:rank="bench.rank.value"
			@pick="bench.setPick"
		/>
		<StatsStrip :attempt="shown" />

		<section class="panel chart-panel" aria-label="Pace chart">
			<template v-if="state === 'error'">
				<div class="message danger" role="alert">
					<p>The performance detail could not be read. {{ error }}</p>
					<button type="button" @click="retry()">Try again</button>
				</div>
			</template>
			<p v-else-if="!analysis" class="message pending reserve">Loading detail…</p>
			<template v-else-if="analysis.noCurve">
				<p v-if="analysis.noCurve.reason === 'no-perf'" class="message">
					No performance detail was imported for this attempt. The result above is complete and valid; only the
					within-run chart and bot breakdown are unavailable.
				</p>
				<p v-else class="message">
					This run has a performance file, but it cannot be charted: {{ analysis.noCurve.detail }}. The result
					above is unaffected.
				</p>
			</template>
			<template v-else-if="current && chart && baseline">
				<ChartControls
					:settings="settings"
					:kind="current.params.kind"
					:recent-count="analysis.recent.length"
					:baseline-kind="baseline.kind"
					:baseline-label="baseline.kind === 'none' ? null : baseline.label"
					:ranks-disabled="ranksDisabled"
					@update="update"
				/>
				<UnifiedChart
					:data="chart"
					:kind="current.params.kind"
					:budget="budget"
					:layers="layers"
					:baseline="chartBaseline"
					:encounters="spans"
					:colors="colors"
					:highlight="highlight"
					:readout-at="readoutAt"
					:recent-count="analysis.recent.length"
					:time-at="timeAt"
					:ranks="chartRanks"
				/>
				<footer class="legend">
					<span>thin = local pace · thick = accumulated pace (projected final {{ race ? 'time' : 'score' }})</span>
					<span>solid = this run · dashed = baseline<template v-if="baseline.kind === 'flat'"> · dotted = PB without a curve</template></span>
					<span v-if="baseline.kind === 'none'" class="final">
						{{ baseline.reason === 'is-pb' ? 'this is the PB' : baseline.reason === 'first-run' ? 'first run of this scenario' : 'no comparable charted run' }}
					</span>
					<span v-else-if="footer" class="final" :class="footer.tone">{{ footer.text }}</span>
				</footer>
			</template>
		</section>

		<BotTable
			v-if="table && baseline"
			class="bots"
			:data="table"
			:colors="colors"
			:baseline-label="baseline.kind === 'none' ? null : baseline.label"
			:baseline-flat="baseline.kind === 'flat'"
			:active="hovered"
			:pinned="pinned"
			@hover="hovered = $event"
			@toggle="toggle"
		/>
		<p v-else-if="noKills" class="note">No kills were recorded, so this run has no bot encounters.</p>
	</div>
</template>

<style scoped>
.detail {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
	transition: opacity 120ms ease;
}

/* The previous run while the next one loads: dimmed only if the load is slow. */
.detail.stale {
	opacity: 0.55;
	transition-delay: 200ms;
}

.panel {
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: 3px;
	min-width: 0;
}

.chart-panel {
	padding-bottom: 8px;
}

.chart-panel :deep(.chart) {
	padding: 4px 8px 0 0;
}

.message {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-3);
	padding: var(--space-4);
	color: var(--color-text-muted);
	font-size: 0.875rem;
	max-width: 80ch;
}

/* The loaded panel's height (controls, chart, legend), so the chart arriving moves nothing below it. */
.message.reserve {
	min-height: 428px;
	align-content: flex-start;
}

.message.danger {
	color: var(--color-danger);
}

.legend {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 22px;
	padding: 6px 12px 0;
	font: 400 11px/1.4 var(--font-mono);
	color: #6f777f;
}

.final {
	margin-left: auto;
	color: var(--color-text-muted);
}

.final.ahead {
	color: var(--color-ahead);
}

.final.behind {
	color: var(--color-behind);
}

.note {
	padding: 8px 12px;
	border: 1px solid var(--color-border);
	border-radius: 3px;
	color: var(--color-text-muted);
	font: 400 12px/1.4 var(--font-mono);
}

button {
	background: transparent;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	padding: var(--space-1) var(--space-3);
	cursor: pointer;
}

button:hover {
	border-color: var(--color-accent);
}
</style>
