<script setup lang="ts">
/**
 * The progression chart's panel (S5, S6 of the scenario page design): the
 * Overall tab and one tab per bot or race slot, the x-axis toggle, and the
 * legend. Opening a bot tab for the first time asks for bot values.
 */
import { computed, ref, toRef, watch } from 'vue';
import { useStorage } from '@vueuse/core';
import type { Candidate } from '../lib/benchmarks/pick';
import { formatValue } from '../lib/run/format';
import type { BotSeries } from '../lib/scenario/bots';
import { NEUTRAL } from '../lib/scenario/config';
import type { HistoryRun } from '../lib/scenario/queries';
import { useProgressChart } from '../composables/useProgressChart';
import type { BotState, ScenarioData } from '../composables/useScenario';
import ProgressChart from './ProgressChart.vue';

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
const race = computed(() => props.data.kind.kind === 'race');
const tabs = computed(() => props.data.tabs?.tabs ?? []);
const activeTab = computed(() => tabs.value.find((t) => t.key === tab.value) ?? null);

const { x, breaks, colors, highlight, series, lines, ranks, formatY, tipFor, chartLabel } = useProgressChart(
	toRef(props, 'data'),
	{
		activeTab,
		bots: toRef(props, 'bots'),
		bench: toRef(props, 'bench'),
		group: toRef(props, 'group'),
		dateAxis,
	},
);

const coverage = computed(() => {
	const b = props.bots;
	if (activeTab.value === null || b === null) return null;
	return `${formatValue(b.covered)} of ${formatValue(runs.value.length)} runs have bot detail`;
});

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
		<p v-else-if="series === null || lines === null" class="message pending">Loading bot detail…</p>
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
			<span class="coverage">drag to zoom · ctrl+scroll zooms · shift+drag or drag an axis pans · Escape resets</span>
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
