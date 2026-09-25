<script setup lang="ts">
/**
 * The progression chart's panel (S5, S6 of the scenario page design): the
 * Overall tab and one tab per bot or race slot, the x-axis toggle, and the
 * legend. Opening a bot tab for the first time asks for bot values.
 */
import { computed, ref, watch } from 'vue';
import { useStorage } from '@vueuse/core';
import type { Candidate } from '../lib/benchmarks/pick';
import { rankOf } from '../lib/benchmarks/rank';
import { formatScore, formatValue, timeFormat } from '../lib/run/format';
import type { BotSeries } from '../lib/scenario/bots';
import { NEUTRAL } from '../lib/scenario/config';
import { formatDelta, formatResult, formatSens } from '../lib/scenario/format';
import type { HistoryRun } from '../lib/scenario/queries';
import { pbSteps, rollingMedian, sessionBreaks } from '../lib/scenario/series';
import type { BotState, ScenarioData } from '../composables/useScenario';
import ProgressChart, { type ProgressTip } from './ProgressChart.vue';

const props = defineProps<{
	data: ScenarioData;
	bots: BotSeries | null;
	botState: BotState;
	botError: string | null;
	/** The selected benchmark, or null for no bands. */
	bench: Candidate | null;
	/** The highlighted config group, or null. */
	group: number | null;
}>();

const emit = defineEmits<{
	(event: 'load-bots'): void;
	(event: 'open', run: HistoryRun): void;
}>();

const OVERALL = '';
const tab = ref(OVERALL);
watch(
	() => props.data.scenario.hash,
	() => (tab.value = OVERALL),
);
watch(tab, (key) => {
	if (key !== OVERALL) emit('load-bots');
});

const axis = useStorage<'attempt' | 'date'>('aimcurve.scenario-axis', 'attempt', localStorage);
const dateAxis = computed(() => axis.value === 'date');

const runs = computed(() => props.data.runs);
const kind = computed(() => props.data.kind);
const race = computed(() => kind.value.kind === 'race');
const tabs = computed(() => props.data.tabs?.tabs ?? []);
const activeTab = computed(() => tabs.value.find((t) => t.key === tab.value) ?? null);

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
const colors = computed(() => props.data.groupOf.map((g) => props.data.groups[g]?.color ?? null));
const highlight = computed(() => (props.group === null ? null : props.data.groupOf.map((g) => g === props.group)));

/**
 * The series the active tab plots, on the score scale either way: the run's
 * score, or a bot's pace. Null while bot values load.
 */
const series = computed(() => {
	const t = activeTab.value;
	if (t === null) return { y: runs.value.map((r) => r.score), raw: null };
	const values = props.bots?.values.get(t.key);
	const raw = props.bots?.raw.get(t.key);
	if (!values || !raw) return null;
	return { y: values, raw };
});

const lines = computed(() => {
	const s = series.value;
	if (s === null) return null;
	const m = rollingMedian(s.y, 10);
	return { best: pbSteps(s.y, 'higher'), median: m.value, full: m.full };
});

/** The best value the tab plots: the y range reaches the rank above it when near. */
const top = computed(() => {
	let best: number | null = null;
	for (const v of series.value?.y ?? []) if (v !== null && (best === null || v > best)) best = v;
	return best;
});

const ranks = computed(() => {
	const c = props.bench;
	if (c === null) return null;
	const t = top.value;
	return { ranks: c.benchmark.ranks, thresholds: c.thresholds, next: t === null ? null : rankOf(c.thresholds, t).next };
});

function rankName(score: number): string | null {
	const c = props.bench;
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
	const group = props.data.groups[props.data.groupOf[i]!]!;
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
	if (median != null) rows.push({ label: l.full[i] ? 'median of last 10' : 'median so far', value: formatResult(median, kind.value) });
	rows.push({ label: `config ${group.label}`, value: formatSens(group.config) });
	return {
		head: `#${i + 1} · ${timeFormat.format(new Date(run.startedAt))}`,
		sub: `session ${sessionNo.value[i]}`,
		rows,
	};
}

const coverage = computed(() => {
	const b = props.bots;
	if (activeTab.value === null || b === null) return null;
	return `${formatValue(b.covered)} of ${formatValue(runs.value.length)} runs have bot detail`;
});

const chartLabel = computed(() =>
	activeTab.value === null
		? `${race.value ? 'Time' : 'Score'} of every completed run`
		: `Pace on ${activeTab.value.label} in every completed run`,
);

const legendConfigs = computed(() =>
	props.data.groups.filter((g) => g.color !== null).map((g) => ({ label: g.label, color: g.color! })),
);
const anyNeutral = computed(() => props.data.groups.some((g) => g.color === null));
</script>

<template>
	<section class="panel" aria-label="Progression">
		<header>
			<div class="tabs" role="tablist" aria-label="Progression of">
				<button
					type="button"
					role="tab"
					:aria-selected="tab === OVERALL"
					:class="{ on: tab === OVERALL }"
					@click="tab = OVERALL"
				>
					Overall
				</button>
				<button
					v-for="t in tabs"
					:key="t.key"
					type="button"
					role="tab"
					:aria-selected="tab === t.key"
					:class="{ on: tab === t.key }"
					@click="tab = t.key"
				>
					{{ t.label }}
				</button>
			</div>
			<div class="axis" role="group" aria-label="x axis">
				<button type="button" :class="{ on: !dateAxis }" :aria-pressed="!dateAxis" @click="axis = 'attempt'">attempt</button>
				<button type="button" :class="{ on: dateAxis }" :aria-pressed="dateAxis" @click="axis = 'date'">date</button>
			</div>
		</header>

		<p v-if="activeTab && botState === 'error'" class="message danger" role="alert">
			Bot detail could not be read. {{ botError }}
			<button type="button" @click="emit('load-bots')">Try again</button>
		</p>
		<p v-else-if="series === null || lines === null" class="message">Loading bot detail…</p>
		<ProgressChart
			v-else
			:x="x"
			:date-axis="dateAxis"
			:y="series.y"
			:best="lines.best"
			:median="lines.median"
			:median-full="lines.full"
			:breaks="breaks"
			:colors="colors"
			:highlight="highlight"
			:ranks="ranks"
			:format-y="formatY"
			:tip-for="tipFor"
			:label="chartLabel"
			@open="emit('open', runs[$event]!)"
		/>

		<footer class="legend">
			<span class="configs">
				<span v-for="c in legendConfigs" :key="c.label"><i :style="{ background: c.color }" aria-hidden="true"></i>{{ c.label }}</span>
				<span v-if="anyNeutral"><i :style="{ background: NEUTRAL }" aria-hidden="true"></i>older configs</span>
			</span>
			<span><b class="amber" aria-hidden="true"></b>best so far</span>
			<span><b class="white" aria-hidden="true"></b>median of last 10 (fades in over the first 10 runs)</span>
			<span v-if="breaks.length > 0"><b class="rule" aria-hidden="true"></b>new session</span>
			<span v-if="coverage" class="coverage">{{ coverage }}</span>
			<span v-if="activeTab" class="coverage">
				pace = the {{ race ? 'race time' : 'run score' }} at this bot's rate, as in Run's bot table · time between
				bots is left out, so bot paces need not add up to the final result</span
			>
		</footer>
	</section>
</template>

<style scoped>
.panel {
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: 3px;
	min-width: 0;
	padding-bottom: 8px;
}

header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px 14px;
	padding: 6px 8px;
	border-bottom: 1px solid var(--color-border);
}

.tabs,
.axis {
	display: flex;
	flex-wrap: wrap;
	gap: 2px;
}

button {
	background: transparent;
	border: 1px solid transparent;
	border-radius: 3px;
	padding: 4px 10px;
	font: 400 12px/1.3 var(--font-mono);
	color: var(--color-text-muted);
	cursor: pointer;
}

button:hover {
	color: var(--color-text-strong);
	background: color-mix(in srgb, var(--color-text) 7%, transparent);
}

button.on {
	color: var(--color-text-strong);
	border-color: var(--color-border-strong);
	background: #171c21;
}

.axis button {
	font-size: 11px;
	padding: 3px 8px;
}

.panel :deep(.chart) {
	padding: 4px 8px 0 0;
}

.message {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-3);
	min-height: 120px;
	padding: var(--space-4);
	color: var(--color-text-muted);
	font-size: 0.875rem;
}

.message.danger {
	color: var(--color-danger);
}

.message button {
	border-color: var(--color-border-strong);
}

.legend {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 20px;
	padding: 6px 12px 0;
	font: 400 11px/1.4 var(--font-mono);
	color: #6f777f;
}

.legend span {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.configs {
	gap: 12px !important;
}

.legend i {
	width: 8px;
	height: 8px;
	border-radius: 50%;
}

.legend b {
	width: 16px;
	height: 0;
}

.amber {
	border-top: 2px solid #f0b23f;
}

.white {
	border-top: 3px solid #e8ebee;
}

.rule {
	border-top: 1px dashed #4a535c;
}

.coverage {
	color: var(--color-text-muted);
}
</style>
