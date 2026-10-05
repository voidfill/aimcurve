<script setup lang="ts">
/**
 * The difficulty page's header (P1, P2 of the benchmarks page design): the
 * way back to the index, the benchmark and its difficulties, coverage, the
 * settings and a legend for the candle and the pills.
 */
import { computed } from 'vue';
import type { SnapshotBenchmark } from '../lib/benchmarks/snapshot';
import { type Coverage, type CoverageMode, isFull } from '../lib/energy/aggregate';
import { STALE_MS } from '../composables/useBenchmarkPage';
import { CANDLE_WINDOWS, type ChartAxis, FORM_WINDOWS } from '../composables/useChartSettings';
import { BODY_MIN } from '../lib/energy/spread';

const STALE_DAYS = STALE_MS / 86_400_000;

const props = defineProps<{
	benchmark: SnapshotBenchmark;
	family: readonly SnapshotBenchmark[];
	coverage: Coverage | null;
}>();

const mode = defineModel<CoverageMode>('mode', { required: true });
const candleWindow = defineModel<number>('candleWindow', { required: true });
const formWindow = defineModel<number>('formWindow', { required: true });
const axis = defineModel<ChartAxis>('axis', { required: true });

const coverageText = computed(() => {
	const c = props.coverage;
	if (c === null) return null;
	const [played, total] = c.scenarios;
	if (isFull(c)) return `${played}/${total} scenarios`;
	return mode.value === 'strict' ? `strict · ${played}/${total} scenarios, the rest count as 0` : `provisional · ${played}/${total} scenarios`;
});

function number(event: Event): number {
	return Number((event.target as HTMLSelectElement).value);
}
</script>

<template>
	<section class="header" aria-labelledby="benchmark-heading">
		<div class="title">
			<RouterLink class="back" :to="{ name: 'benchmarks' }">← Benchmarks</RouterLink>
			<div class="name">
				<h1 id="benchmark-heading">{{ benchmark.name }}</h1>
				<nav v-if="family.length > 1" class="difficulties" aria-label="Difficulty">
					<RouterLink
						v-for="d in family"
						:key="d.id"
						:to="{ name: 'benchmark', params: { id: d.id } }"
						:class="{ on: d.id === benchmark.id }"
						:aria-current="d.id === benchmark.id ? 'page' : undefined"
						>{{ d.difficulty }}</RouterLink
					>
				</nav>
				<span v-else class="single">{{ benchmark.difficulty }}</span>
				<span
					class="chip"
					title="aimcurve's own balanced score per difficulty: 100 per rank step, scenarios averaged per subcategory, then shifted geometric means. Not Voltaic's or Evxl's energy."
					>Custom energy</span
				>
			</div>
			<p v-if="coverageText" class="coverage">{{ coverageText }}</p>
		</div>

		<div class="settings">
			<div class="segment" role="group" aria-label="Coverage">
				<button
					type="button"
					:class="{ on: mode === 'provisional' }"
					:aria-pressed="mode === 'provisional'"
					title="Only what has been played counts"
					@click="mode = 'provisional'"
				>
					provisional
				</button>
				<button
					type="button"
					:class="{ on: mode === 'strict' }"
					:aria-pressed="mode === 'strict'"
					title="Unplayed scenarios count as 0"
					@click="mode = 'strict'"
				>
					strict
				</button>
			</div>
			<label class="select" title="The candle and the median pill take each scenario's latest runs">
				<span>candle</span>
				<select :value="candleWindow" @change="candleWindow = number($event)">
					<option v-for="n in CANDLE_WINDOWS" :key="n" :value="n">last {{ n }}</option>
				</select>
			</label>
			<label class="select" title="Form, the charts' white line, is the median of this many latest runs. Shared with the scenario page.">
				<span>form</span>
				<select :value="formWindow" @change="formWindow = number($event)">
					<option v-for="n in FORM_WINDOWS" :key="n" :value="n">last {{ n }}</option>
				</select>
			</label>
			<div class="segment" role="group" aria-label="Chart x axis">
				<button type="button" :class="{ on: axis === 'attempt' }" :aria-pressed="axis === 'attempt'" @click="axis = 'attempt'">
					runs
				</button>
				<button type="button" :class="{ on: axis === 'date' }" :aria-pressed="axis === 'date'" @click="axis = 'date'">date</button>
			</div>
		</div>

		<div class="legend">
			<span class="item">
				<svg viewBox="0 0 92 14" width="92" height="14" aria-hidden="true">
					<line x1="4" x2="24" y1="7" y2="7" stroke="#8b9299" stroke-width="2" />
					<rect x="3" y="2" width="2" height="10" fill="#8b9299" />
					<rect x="24" y="2" width="38" height="10" rx="3" fill="#2FCFC2" fill-opacity="0.45" stroke="#2FCFC2" stroke-width="1.5" />
					<rect x="41" y="0" width="2.5" height="14" fill="#ffffff" />
					<line x1="62" x2="84" y1="7" y2="7" stroke="#B9F2FF" stroke-width="2" />
					<circle cx="84" cy="7" r="4.5" fill="#B9F2FF" stroke="#0b0d0f" stroke-width="1.5" />
				</svg>
				worst · p10–p90 · median of the last {{ candleWindow }} runs · all-time PB, each in the colour of the rank it reaches
			</span>
			<span class="item">fewer than {{ BODY_MIN }} runs: one tick per run</span>
			<span class="item">categories and the overall aggregate each statistic on its own: an approximation, not a percentile</span>
			<span class="item">pills fill toward the next rank; at the top rank, with the overflow</span>
			<span class="item">faded: last played over {{ STALE_DAYS }} days ago</span>
		</div>
	</section>
</template>

<style scoped>
.header {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	justify-content: space-between;
	gap: var(--space-3) 26px;
	padding-bottom: 12px;
	border-bottom: 1px solid var(--color-border);
}

.title {
	min-width: 0;
	flex: 1 1 420px;
}

.back {
	font: 400 11.5px/1 var(--font-mono);
	color: var(--color-text-faint);
	text-decoration: none;
}

.back:hover {
	color: var(--color-text);
}

.name {
	margin-top: 8px;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 14px;
}

h1 {
	font-weight: 500;
	font-size: 25px;
	letter-spacing: -0.015em;
	color: var(--color-text-strong);
}

.difficulties {
	display: flex;
	flex-wrap: wrap;
	border: 1px solid var(--color-border);
	border-radius: 3px;
	overflow: hidden;
}

.difficulties a {
	padding: 4px 10px;
	font: 400 11.5px/1.2 var(--font-mono);
	color: var(--color-text-faint);
	text-decoration: none;
}

.difficulties a + a {
	border-left: 1px solid var(--color-border);
}

.difficulties a:hover {
	color: var(--color-text);
}

.difficulties a.on {
	color: var(--color-text);
	background: var(--color-surface-raised);
	box-shadow: inset 0 1px 0 var(--color-accent);
}

.single {
	font: 400 12px/1 var(--font-mono);
	color: var(--color-text-muted);
}

.chip {
	padding: 3px 7px;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	font: 500 10px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.12em;
	color: var(--color-text-muted);
	cursor: help;
}

.coverage {
	margin-top: 6px;
	font: 400 11.5px/1.2 var(--font-mono);
	color: var(--color-text-faint);
}

.settings {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 12px;
}

.segment {
	display: flex;
	border: 1px solid var(--color-border);
	border-radius: 3px;
	overflow: hidden;
}

.segment button {
	padding: 4px 9px;
	border: 0;
	background: transparent;
	cursor: pointer;
	font: 400 11px/1 var(--font-mono);
	color: var(--color-text-faint);
}

.segment button + button {
	border-left: 1px solid var(--color-border);
}

.segment button.on {
	color: var(--color-text);
	background: var(--color-surface-raised);
	box-shadow: inset 0 1px 0 var(--color-accent);
}

.select {
	display: flex;
	align-items: center;
	gap: 6px;
	font: 500 10px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.14em;
	color: var(--color-text-faint);
}

.select select {
	padding: 4px 6px;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	background: transparent;
	color: var(--color-text-muted);
	font: 400 11.5px/1.2 var(--font-mono);
	letter-spacing: 0;
	text-transform: none;
	cursor: pointer;
}

.select select:hover {
	border-color: var(--color-accent);
}

.select option {
	background: var(--color-surface);
	color: var(--color-text);
}

.legend {
	flex: 1 1 100%;
	display: flex;
	flex-wrap: wrap;
	gap: 6px 18px;
	font: 400 11px/1.4 var(--font-mono);
	color: #6f777f;
}

.item {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}
</style>
