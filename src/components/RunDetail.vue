<script setup lang="ts">
/**
 * One inspected run, fully analysed: header, stats, the unified chart and the
 * bot breakdown, all against one baseline (Run view R1, R2).
 *
 * The header and stats render from the attempt straight away. The chart and
 * table wait for the analysis, and a failure there leaves the header in place.
 */
import { computed, ref, toRef, watch } from 'vue';
import ChartControls from './ChartControls.vue';
import BotTable, { type BotTableData } from './BotTable.vue';
import RunHeader from './RunHeader.vue';
import StatsStrip from './StatsStrip.vue';
import UnifiedChart, { type ChartLayers } from './UnifiedChart.vue';
import { useRunAnalysis, type ChartSettings } from '../composables/useRunAnalysis';
import { flatReadout } from '../lib/run/baseline';
import { bestSplits, botColors, clockRows, type Encounter, encounters, raceRows } from '../lib/run/bots';
import { type ChartBaseline, chartData } from '../lib/run/chart-data';
import { formatScore, formatSigned, formatValue } from '../lib/run/format';
import type { Attempt } from '../lib/run/queries';
import { killTimes, paceFor, readout, recentRange, type RunCurve } from '../lib/scoring';

const props = defineProps<{ attempt: Attempt }>();

const { state, error, analysis, baseline, settings, retry } = useRunAnalysis(toRef(props, 'attempt'));

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

function spansOf(curve: RunCurve, stem: string): Encounter[] {
	const a = analysis.value;
	const kills = a?.killsOf(stem);
	const input = a?.inputOf(stem);
	if (!kills || !input) return [];
	return encounters(curve, kills, killTimes(input));
}

const spans = computed<Encounter[]>(() => (current.value ? spansOf(current.value, current.value.fileStem) : []));
const colors = computed(() => botColors(spans.value.map((e) => e.bot)));

const table = computed<BotTableData | null>(() => {
	const cur = current.value;
	const a = analysis.value;
	if (!cur || !a || spans.value.length === 0) return null;
	const base = baseCurve.value;
	if (cur.params.kind === 'race') {
		const best = bestSplits([...a.raceCandidates, cur], cur.params.bots);
		return { kind: 'race', rows: raceRows(cur, spans.value, base, best) };
	}
	const kills = a.killsOf(cur.fileStem)!;
	const baseSpans = base ? { curve: base, spans: spansOf(base, base.fileStem) } : null;
	return { kind: 'clock', table: clockRows(cur, spans.value, kills, baseSpans) };
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

const layers = computed<ChartLayers>(() => ({
	local: settings.value.local,
	accumulated: settings.value.accumulated,
	baseline: settings.value.baseline,
	baseLocal: settings.value.baseLocal,
	recent: settings.value.recent,
}));

/* Bot highlight: hover wins over the pinned row. */
const hovered = ref<string | null>(null);
const pinned = ref<string | null>(null);
watch(
	() => props.attempt.fileStem,
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
	const score = props.attempt.score;
	if (!b || b.kind === 'none' || score === null) return null;
	const digits = race.value ? 2 : 1;
	const shown = (s: number) => (budget.value === null ? formatScore(s) : `${formatValue(budget.value - s, 2)} s`);
	const diff = score - b.score;
	return {
		text: `final ${shown(score)} vs ${b.label} ${shown(b.score)} · ${formatSigned(diff, digits)} ${race.value ? 's' : 'pts'}`,
		tone: diff > 0 ? 'ahead' : diff < 0 ? 'behind' : '',
	};
});

const noKills = computed(() => current.value !== null && current.value.params.kind === 'clock' && spans.value.length === 0);
</script>

<template>
	<div class="detail">
		<RunHeader :attempt="attempt" :current="current" :baseline="baseline" />
		<StatsStrip :attempt="attempt" />

		<section class="panel chart-panel" aria-label="Pace chart">
			<template v-if="state === 'error'">
				<div class="message danger" role="alert">
					<p>The performance detail could not be read. {{ error }}</p>
					<button type="button" @click="retry()">Try again</button>
				</div>
			</template>
			<p v-else-if="state !== 'ready' || !analysis" class="message">Loading detail…</p>
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
