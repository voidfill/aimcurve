<script setup lang="ts">
/**
 * One inspected run, fully analysed: header, stats, the unified chart and the
 * bot breakdown, all against one baseline (Run view R1, R2).
 *
 * On first mount the header and stats render from the attempt straight away
 * and the chart and table wait for the analysis. A later switch holds the
 * previous run until the next is analysed. A failure leaves the header in place.
 */
import { computed, shallowRef, toRef, watch } from 'vue';
import ChartControls from './ChartControls.vue';
import BotTable from './BotTable.vue';
import RunHeader from './RunHeader.vue';
import StatsStrip from './StatsStrip.vue';
import UnifiedChart, { type ChartLayers } from './UnifiedChart.vue';
import { useBenchmarkRank } from '../composables/useBenchmarkRank';
import { type ChartSettings, useChartSettings, useRunAnalysis } from '../composables/useRunAnalysis';
import { useRunCharts } from '../composables/useRunCharts';
import { formatScore, formatSigned, formatValue } from '../lib/run/format';
import type { Attempt } from '../lib/run/queries';

const props = defineProps<{
	attempt: Attempt;
	/**
	 * The detail fills its column's height: the chart takes what the header,
	 * stats and bot table leave, and the bot table scrolls once the chart is at
	 * its floor. Off, the chart has its fixed height and the page scrolls.
	 */
	fill?: boolean;
}>();

const settings = useChartSettings();
const {
	state,
	error,
	analysis: latest,
	baseline: latestBaseline,
	retry,
} = useRunAnalysis(
	toRef(props, 'attempt'),
	computed(() => settings.value.option),
);

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

const ranksDisabled = computed(() =>
	bench.candidates.value.length === 0
		? 'This scenario is in no known benchmark'
		: bench.selected.value === null
			? 'No benchmark is selected'
			: null,
);

function update(patch: Partial<ChartSettings>): void {
	settings.value = { ...settings.value, ...patch };
}

const {
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
	toggle,
} = useRunCharts(analysis, baseline, bench, {
	layers: computed<ChartLayers>(() => ({
		local: settings.value.local,
		accumulated: settings.value.accumulated,
		baseline: settings.value.baseline,
		baseLocal: settings.value.baseLocal,
		recent: settings.value.recent,
		ranks: settings.value.ranks,
	})),
	window: computed(() => settings.value.window),
});

function hover(key: string | null): void {
	hovered.value = key;
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

/** The chart panel holds, or is about to hold, a chart: only then does it take the spare height. */
const grows = computed(
	() => state.value !== 'error' && (analysis.value === null || (!analysis.value.noCurve && chart.value !== null)),
);

const noKills = computed(() => current.value !== null && current.value.params.kind === 'clock' && spans.value.length === 0);
</script>

<template>
	<div class="detail" :class="{ stale, fill }" :aria-busy="stale">
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

		<section class="panel chart-panel" :class="{ grows }" aria-label="Pace chart">
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
			@hover="hover"
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

/*
	Filling: the chart panel takes the height left over, down to a floor; the
	bot table keeps its own height until the chart is at that floor, then
	shrinks to its own and scrolls. Below both floors the column scrolls.

	Both start from a zero basis, so the detail's own height is the sum of the
	floors and it never outgrows the column by itself. The bot table's huge
	grow factor hands it the spare height first, up to its natural height;
	everything past that goes to the chart.
*/
.detail.fill {
	flex: 1 0 auto;
}

.detail.fill .chart-panel.grows {
	display: flex;
	flex-direction: column;
	flex: 1 1 0;
	min-height: 320px;
}

.detail.fill .chart-panel.grows :deep(.chart) {
	flex: 1 1 0;
	height: auto;
	min-height: 0;
}

.detail.fill .message.reserve {
	min-height: 0;
}

.detail.fill .bots {
	flex: 1000 1 0;
	/* Its header, column heads and exactly four rows, as a three-bot table with dead time stands. */
	min-height: 156px;
	max-height: max-content;
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
