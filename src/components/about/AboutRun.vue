<script setup lang="ts">
/**
 * About beats 1 and 2 (D5 of the About design): the demo run's pace chart and
 * its bot breakdown, sharing one highlight, drawn by the same composables as
 * the Run view with fixed settings. Both beats' copy comes first and the
 * table sits directly under the chart, so hovering a row lights up
 * encounters that are still on screen.
 *
 * Reads the snapshot source its parent provides.
 */
import { computed, toRef } from 'vue';
import BotTable from '../BotTable.vue';
import UnifiedChart from '../UnifiedChart.vue';
import { formatValue } from '../../lib/run/format';
import type { Attempt } from '../../lib/run/queries';
import { useDemoRun } from './useDemoRun';

const props = defineProps<{ attempt: Attempt }>();

const { state, retry, bench, charts } = useDemoRun(toRef(props, 'attempt'));
const { current, budget, chart, layers, chartBaseline, chartRanks, readoutAt, timeAt, spans, colors, table, hovered, pinned, highlight, pinnedSpans, toggle } =
	charts;

function hover(key: string | null): void {
	hovered.value = key;
}

const unit = computed(() => (charts.race.value ? 's' : 'points'));
const digits = computed(() => (charts.race.value ? 1 : 0));

/** Where the run was furthest ahead of its baseline, and where it finished. */
const story = computed(() => {
	const at = readoutAt.value;
	if (at === null) return null;
	let lead = -Infinity;
	let leadX = 0;
	for (let x = 0.05; x <= 1; x += 0.01) {
		const v = at(x);
		if (v > lead) [lead, leadX] = [v, x];
	}
	return { lead, leadAt: Math.round(timeAt.value(leadX)), end: at(1) };
});

const benchName = computed(() => bench.selected.value?.benchmark.name ?? null);
</script>

<template>
	<section class="beat" aria-labelledby="beat-run">
		<div class="copies">
			<div class="copy">
				<p class="step">01</p>
				<h2 id="beat-run">See where the run slipped.</h2>
				<p>
					The thick lines are your projected final result as the run unfolds: this run in white, your previous best
					dashed in amber.
					<template v-if="story && story.lead > 0 && story.end < 0">
						This run was <strong class="ahead">{{ formatValue(story.lead, digits) }} {{ unit }} ahead</strong> of the
						PB {{ story.leadAt }} seconds in, and finished
						<strong class="behind">{{ formatValue(-story.end, digits) }} {{ unit }} behind</strong>.
					</template>
					Hover the chart to see exactly where it turned<template v-if="benchName"
						>; the bands behind it are the {{ benchName }} ranks</template
					>.
				</p>
			</div>
			<div class="copy">
				<p class="step">02</p>
				<h2 id="beat-bots">Find the bot that costs you.</h2>
				<p>
					Every bot encounter, timed against the same PB run. The biggest losses stand out; hover a row, or click to
					pin it, and its encounters light up on the chart.
				</p>
			</div>
		</div>
		<div class="panel chart-panel" data-shot="pace">
			<p class="sample">Sample run · {{ attempt.scenarioName }}</p>
			<p v-if="state === 'error'" class="message" role="alert">
				This sample could not be drawn. <button type="button" @click="retry()">Try again</button>
			</p>
			<UnifiedChart
				v-else-if="current && chart && chartBaseline"
				:data="chart"
				:kind="current.params.kind"
				:budget="budget"
				:layers="layers"
				:baseline="chartBaseline"
				:encounters="spans"
				:colors="colors"
				:highlight="highlight"
				:pinned="pinnedSpans"
				:readout-at="readoutAt"
				:recent-count="0"
				:time-at="timeAt"
				:ranks="chartRanks"
			/>
			<div v-else class="placeholder" aria-hidden="true"></div>
		</div>
		<BotTable
			v-if="table && chartBaseline"
			class="bots"
			data-shot="bots"
			aria-labelledby="beat-bots"
			:data="table"
			:colors="colors"
			:baseline-label="chartBaseline.label"
			:baseline-flat="chartBaseline.kind === 'flat'"
			:active="hovered"
			:pinned="pinned"
			@hover="hover"
			@toggle="toggle"
		/>
	</section>
</template>

<style scoped src="./beat.css"></style>
