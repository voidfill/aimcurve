<script setup lang="ts">
/**
 * The difficulty page's header: the
 * way back to the index, the benchmark and its difficulties, coverage, the
 * settings and a legend for the candle and the pills.
 *
 * Three siblings, not one box, so the middle one can pin: the bar with the
 * name and every setting sticks to the top of the page scroller (pure CSS,
 * `position: sticky`), while the back link above it and the coverage and
 * legend below it scroll away. Its height is `--bar-h`, which the sheet's
 * column legend pins beneath.
 *
 * The ARC chip shows and hides a plain explainer of ARC (docs/arc.md), above
 * all that it is not Voltaic's, Evxl's or anyone's official number. It is open
 * until first closed, and remembered per browser.
 */
import { computed, nextTick, ref } from 'vue';
import { useStorage } from '@vueuse/core';
import type { SnapshotBenchmark } from '../lib/benchmarks/snapshot';
import { type Coverage, type CoverageMode, isFull } from '../lib/arc/aggregate';
import { STALE_MS } from '../composables/useBenchmarkPage';
import type { ChartAxis } from '../composables/useChartSettings';
import RunWindowSelect from './RunWindowSelect.vue';
import { BODY_MIN } from '../lib/arc/spread';

const STALE_DAYS = STALE_MS / 86_400_000;

const props = defineProps<{
	benchmark: SnapshotBenchmark;
	family: readonly SnapshotBenchmark[];
	coverage: Coverage | null;
	/** The run window, for the legend's wording; set by `RunWindowSelect`. */
	runWindow: number;
}>();

const mode = defineModel<CoverageMode>('mode', { required: true });
const axis = defineModel<ChartAxis>('axis', { required: true });

const explainer = useStorage('aimcurve.arc-explainer', true);
const explainerEl = ref<HTMLElement | null>(null);

async function toggleExplainer(): Promise<void> {
	explainer.value = !explainer.value;
	if (!explainer.value) return;
	await nextTick();
	explainerEl.value?.scrollIntoView({ block: 'nearest' });
}

const coverageText = computed(() => {
	const c = props.coverage;
	if (c === null) return null;
	const [played, total] = c.scenarios;
	if (isFull(c)) return `${played}/${total} scenarios`;
	return mode.value === 'strict' ? `strict · ${played}/${total} scenarios, the rest count as 0` : `provisional · ${played}/${total} scenarios`;
});

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
		<button
			type="button"
			class="chip"
			:class="{ on: explainer }"
			:aria-expanded="explainer"
			aria-controls="arc-explainer"
			title="What ARC is"
			@click="toggleExplainer"
		>
			ARC
		</button>

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
			<RunWindowSelect />
			<div class="segment" role="group" aria-label="Chart x axis">
				<button type="button" :class="{ on: axis === 'attempt' }" :aria-pressed="axis === 'attempt'" @click="axis = 'attempt'">
					runs
				</button>
				<button type="button" :class="{ on: axis === 'date' }" :aria-pressed="axis === 'date'" @click="axis = 'date'">date</button>
			</div>
		</div>
	</div>

	<div class="details">
		<section v-if="explainer" id="arc-explainer" ref="explainerEl" class="explainer" aria-label="About ARC">
			<p>
				<strong>ARC</strong> is the <em>aimcurve rank composite</em>: one number for where you stand on this
				difficulty. Every rank is worth 100 arc, and progress in between counts, so halfway from the third rank to
				the fourth is 350. Scenarios average into their subcategory; subcategories and categories then combine so
				that a weak spot pulls the total down, but never to zero.
			</p>
			<p class="not">
				ARC is aimcurve's own. It is not Voltaic energy, Evxl's energy or any benchmark's official score, and it does
				not convert to them: 400 arc is not 400 energy, and an ARC rank is not an official rank.
			</p>
			<button type="button" class="close" aria-label="Hide the ARC explainer" @click="toggleExplainer">×</button>
		</section>
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
	background: transparent;
	font: 500 10px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.12em;
	color: var(--color-text-muted);
	cursor: pointer;
}

.chip:hover,
.chip.on {
	border-color: var(--color-accent);
	color: var(--color-text);
}

.explainer {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 6px;
	max-width: 760px;
	padding: 10px 36px 10px 12px;
	border: 1px solid var(--color-border);
	border-radius: 15px;
	background: var(--color-surface);
	font: 400 12.5px/1.5 var(--font-sans);
	color: var(--color-text-muted);
}

.explainer strong {
	font-weight: 600;
	color: var(--color-text-strong);
}

.explainer .not {
	color: var(--color-text);
}

.explainer .close {
	position: absolute;
	top: 6px;
	right: 10px;
	border: 0;
	background: transparent;
	font: 400 16px/1 var(--font-sans);
	color: var(--color-text-faint);
	cursor: pointer;
}

.explainer .close:hover {
	color: var(--color-text);
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
