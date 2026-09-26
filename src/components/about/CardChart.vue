<script setup lang="ts">
/**
 * The demo run's pace chart alone, for the link-preview card: no tooltip
 * target, no table, sized by its container.
 */
import { toRef } from 'vue';
import UnifiedChart from '../UnifiedChart.vue';
import type { Attempt } from '../../lib/run/queries';
import { useDemoRun } from './useDemoRun';

const props = defineProps<{ attempt: Attempt }>();

const { charts } = useDemoRun(toRef(props, 'attempt'));
const { current, budget, chart, layers, chartBaseline, chartRanks, readoutAt, timeAt, spans, colors } = charts;
</script>

<template>
	<UnifiedChart
		v-if="current && chart && chartBaseline"
		:data="chart"
		:kind="current.params.kind"
		:budget="budget"
		:layers="layers"
		:baseline="chartBaseline"
		:encounters="spans"
		:colors="colors"
		:highlight="null"
		:readout-at="readoutAt"
		:recent-count="0"
		:time-at="timeAt"
		:ranks="chartRanks"
	/>
</template>
