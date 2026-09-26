<script setup lang="ts">
/**
 * About beat 3 (D5 of the About design): every run of the progression demo
 * scenario on the scenario page's progression chart, Overall tab. By attempt,
 * not date: its runs cluster into a few stretches months apart, and on dates
 * the climb would be squeezed between long empty gaps.
 *
 * Reads the snapshot source its parent provides.
 */
import { computed, ref } from 'vue';
import ProgressChart from '../ProgressChart.vue';
import { useBenchmarkRank } from '../../composables/useBenchmarkRank';
import { useProgressChart } from '../../composables/useProgressChart';
import type { ScenarioData } from '../../composables/useScenario';

const props = defineProps<{ data: ScenarioData }>();

const data = computed(() => props.data);
const bench = useBenchmarkRank(
	computed(() => props.data.scenario.name),
	ref(null),
	{ picks: ref({}) },
);
const { x, breaks, colors, highlight, series, lines, ranks, formatY, tipFor, chartLabel } = useProgressChart(data, {
	activeTab: ref(null),
	bots: ref(null),
	bench: bench.selected,
	group: ref(null),
	dateAxis: ref(false),
});

const months = computed(() => {
	const runs = props.data.runs;
	const ms = new Date(runs[runs.length - 1]!.startedAt).getTime() - new Date(runs[0]!.startedAt).getTime();
	return Math.max(1, Math.round(ms / (30.44 * 86_400_000)));
});
</script>

<template>
	<section class="beat" aria-labelledby="beat-progress">
		<div class="copy">
			<p class="step">03</p>
			<h2 id="beat-progress">Watch the curve bend.</h2>
			<p>
				All {{ data.runs.length }} runs of {{ data.scenario.name }} over {{ months === 1 ? 'a month' : `${months} months` }}.
				Each dot is a run, the amber line is your best so far and the white one the median of your last ten, so one
				lucky run cannot fake progress.
			</p>
		</div>
		<div class="panel chart-panel" data-shot="progress">
			<p class="sample">Sample history · {{ data.scenario.name }}</p>
			<ProgressChart
				v-if="series && lines"
				:x="x"
				:date-axis="false"
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
			/>
		</div>
	</section>
</template>

<style scoped src="./beat.css"></style>
