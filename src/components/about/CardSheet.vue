<script setup lang="ts">
/**
 * The demo category's sheet for the link-preview card: no legend, no actions,
 * one subcategory folded open so its history chart shows. Sized by the card;
 * whatever does not fit is cut off.
 */
import { computed, toRef } from 'vue';
import BenchmarkTable from '../BenchmarkTable.vue';
import { DEMO_BENCHMARK_ID } from '../../lib/demo/snapshot';
import { useDemoSheet } from './useDemoSheet';

const props = defineProps<{
	now: number;
	/** The subcategory to show folded open. */
	open: string;
}>();

const { page, runWindow, rows } = useDemoSheet(toRef(props, 'now'));
const opened = computed(() => new Set(rows.value.filter((r) => r.level === 'subcategory' && r.name === props.open).map((r) => r.key)));
</script>

<template>
	<BenchmarkTable
		v-if="page.tree.value && rows.length > 0"
		:rows="rows"
		:ranks="page.tree.value.ranks"
		:open="opened"
		:chart-for="page.chartFor"
		:date-axis="false"
		:run-window="runWindow"
		:benchmark-id="DEMO_BENCHMARK_ID"
		:legend="false"
		:actions="false"
		:now="now"
	/>
</template>
