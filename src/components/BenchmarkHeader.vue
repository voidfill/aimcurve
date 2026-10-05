<script setup lang="ts">
/**
 * The difficulty page's header (P1, P2 of the benchmarks page design): the
 * way back to the index, the benchmark and its difficulties, coverage, the
 * settings and a legend for the candle and the pills.
 *
 * Three siblings, not one box, so the middle one can pin: the bar with the
 * name and every setting sticks to the top of the page scroller (pure CSS,
 * `position: sticky`), while the back link above it and the coverage and
 * legend below it scroll away. Its height is `--bar-h`, which the sheet's
 * column legend pins beneath.
 */
import { computed } from 'vue';
import type { SnapshotBenchmark } from '../lib/benchmarks/snapshot';
import { type Coverage, type CoverageMode, isFull } from '../lib/energy/aggregate';
import { STALE_MS } from '../composables/useBenchmarkPage';
import { type ChartAxis, RUN_WINDOWS } from '../composables/useChartSettings';
import { BODY_MIN } from '../lib/energy/spread';

const STALE_DAYS = STALE_MS / 86_400_000;

const props = defineProps<{
	benchmark: SnapshotBenchmark;
	family: readonly SnapshotBenchmark[];
	coverage: Coverage | null;
}>();

const mode = defineModel<CoverageMode>('mode', { required: true });
const runWindow = defineModel<number>('runWindow', { required: true });
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
	<RouterLink class="back" :to="{ name: 'benchmarks' }">← Benchmarks</RouterLink>

	<div class="bar">
		<h1 id="benchmark-heading" :title="benchmark.name">{{ benchmark.name }}</h1>
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
			<label
				class="select"
				title="How many of each scenario's latest runs count: the candle, the median pill and form, the charts' white line. Shared with the scenario page."
			>
				<span>runs</span>
				<select :value="runWindow" @change="runWindow = number($event)">
					<option v-for="n in RUN_WINDOWS" :key="n" :value="n">last {{ n }}</option>
				</select>
			</label>
			<div class="segment" role="group" aria-label="Chart x axis">
				<button type="button" :class="{ on: axis === 'attempt' }" :aria-pressed="axis === 'attempt'" @click="axis = 'attempt'">
					runs
				</button>
				<button type="button" :class="{ on: axis === 'date' }" :aria-pressed="axis === 'date'" @click="axis = 'date'">date</button>
			</div>
		</div>
	</div>

	<div class="details">
		<p v-if="coverageText" class="coverage">{{ coverageText }}</p>
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
				worst · p10–p90 · median of the last {{ runWindow }} runs · all-time PB, each in the colour of the rank it reaches
			</span>
			<span class="item">fewer than {{ BODY_MIN }} runs: one tick per run</span>
			<span class="item">categories and the overall aggregate each statistic on its own: an approximation, not a percentile</span>
			<span class="item">pills fill toward the next rank; at the top rank, by how far past it</span>
			<span class="item">faded: last played over {{ STALE_DAYS }} days ago</span>
		</div>
	</div>
</template>

<style scoped>
/* Pinned: it sticks to the top of the page scroller, over the page's own background. */
.bar {
	position: sticky;
	top: 0;
	z-index: 3;
	display: flex;
	align-items: center;
	gap: 14px;
	height: var(--bar-h);
	margin: 0 -18px;
	padding: 0 18px;
	background: var(--color-bg);
	border-bottom: 1px solid var(--color-border);
}

.details {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.back {
	/* Close to the bar it leads into: most of the page's 10 px gap is taken back. */
	margin-bottom: -8px;
	font: 400 11.5px/1 var(--font-mono);
	color: var(--color-text-faint);
	text-decoration: none;
}

.back:hover {
	color: var(--color-text);
}

h1 {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 500;
	font-size: 25px;
	letter-spacing: -0.015em;
	color: var(--color-text-strong);
}

.difficulties {
	display: flex;
	flex: none;
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

.single,
.chip {
	flex: none;
	white-space: nowrap;
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
	font: 400 11.5px/1.2 var(--font-mono);
	color: var(--color-text-faint);
}

.settings {
	margin-left: auto;
	flex: none;
	display: flex;
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
