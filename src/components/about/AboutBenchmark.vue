<script setup lang="ts">
/**
 * About beat 3, after the single run: progress across runs, as one category of
 * a real benchmark sheet from the demo snapshot, drawn by the Benchmarks
 * page's own table. Only the category: the whole difficulty is too much to
 * take in at once on a first visit. Its chart, open from the start, is the
 * climb over time.
 *
 * It is the sheet with everything that is the visitor's own taken out: no
 * column legend, no fold actions (Play, Follow, the scenario page) and no
 * stored settings (see `useDemoSheet`).
 */
import { computed, ref, toRef } from 'vue';
import BenchmarkTable from '../BenchmarkTable.vue';
import { DEMO_BENCHMARK_ID, DEMO_CATEGORY } from '../../lib/demo/snapshot';
import { DEMO_RUN_WINDOW as RUN_WINDOW, useDemoSheet } from './useDemoSheet';

const props = defineProps<{
	/** The sample's "now": its last run, epoch ms. */
	now: number;
}>();

const { page, runWindow, category, rows } = useDemoSheet(toRef(props, 'now'));
const scenarios = computed(() => rows.value.filter((r) => r.level === 'scenario').length);

/** The category starts open, its chart showing; any row toggles from there. */
const toggled = ref<Set<string> | null>(null);
const open = computed(() => toggled.value ?? new Set(category.value ? [category.value.key] : []));
function toggle(key: string): void {
	const next = new Set(open.value);
	if (!next.delete(key)) next.add(key);
	toggled.value = next;
}

const sheetName = computed(() => {
	const b = page.benchmark.value;
	return b ? `${b.name} ${b.difficulty}` : null;
});
</script>

<template>
	<section class="beat" aria-labelledby="beat-benchmark">
		<div class="copy">
			<p class="step">03</p>
			<h2 id="beat-benchmark">Watch your whole benchmark climb.</h2>
			<p>
				Every scenario, subcategory and category of a benchmark on one rank axis. Each candle is your last
				{{ RUN_WINDOW }} runs, worst to best with the median in white, beside your PB, so one lucky run cannot fake
				progress. Any row opens into its history: here the whole category, run by run. Hover a candle for the numbers
				behind it.
			</p>
			<p class="fine">
				Categories combine into <strong>ARC</strong>, aimcurve's own rank composite. It is not Voltaic's, Evxl's or any
				official score.
			</p>
		</div>
		<div class="panel sheet-panel" data-shot="benchmark">
			<!-- On the sheet's own grid, so PB and median name the pill columns, as its legend would. -->
			<p class="sample sheet-grid">
				<span class="what"
					>Sample sheet<template v-if="sheetName"> · {{ sheetName }} · {{ DEMO_CATEGORY }}, {{ scenarios }} scenarios</template></span
				>
				<span class="column">PB</span>
				<span class="column">Median · last {{ RUN_WINDOW }}</span>
			</p>
			<BenchmarkTable
				v-if="page.tree.value && rows.length > 0"
				:rows="rows"
				:ranks="page.tree.value.ranks"
				:open="open"
				:chart-for="page.chartFor"
				:date-axis="false"
				:run-window="runWindow"
				:benchmark-id="DEMO_BENCHMARK_ID"
				:legend="false"
				:actions="false"
				:now="now"
				@toggle="toggle"
			/>
			<p v-else-if="page.state.value === 'error' || page.state.value === 'missing'" class="message" role="alert">
				This sample could not be drawn. <button type="button" @click="page.retry()">Try again</button>
			</p>
			<div v-else class="placeholder" aria-busy="true"></div>
		</div>
	</section>
</template>

<style scoped src="./beat.css"></style>

<style scoped>
.sheet-panel {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 0 12px 2px;
}

.sheet-panel .sample {
	padding-top: 10px;
	padding-bottom: 0;
}

.sample .what {
	grid-column: 1 / 3;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	/* Flush with the panel's edge, as the other samples' captions are. */
	margin-left: -12px;
}

.sample .column {
	text-align: center;
}

.copy .fine {
	margin-top: var(--space-2);
	font-size: 0.8125rem;
	color: var(--color-text-faint);
}
</style>
