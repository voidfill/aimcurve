<script setup lang="ts">
/**
 * The Benchmarks sheet's column legend: a long pill naming the columns of
 * `.sheet-grid`, the rank names centred over the lane's columns. The sheet
 * pins it; the scenario page heads its benchmark row with it.
 */
import { computed } from 'vue';
import { chartColor } from '../lib/benchmarks/format';
import type { RankStep } from '../lib/benchmarks/snapshot';
import { laneColumns } from '../lib/arc/axis';

const props = defineProps<{
	ranks: readonly RankStep[];
	/** The run window, for the median column's label. */
	runWindow: number;
	/** The first column's label. */
	first?: string;
}>();

const columns = computed(() => laneColumns(props.ranks).map((c) => ({ name: c.name, tint: chartColor(c.color) })));
</script>

<template>
	<div class="sheet-grid head" role="row">
		<span role="columnheader">{{ first ?? 'Benchmark' }}</span>
		<span class="axis" role="columnheader">
			<span v-for="c in columns" :key="c.name" :style="{ color: c.tint }">{{ c.name }}</span>
		</span>
		<span role="columnheader">PB</span>
		<span role="columnheader">Median · last {{ runWindow }}</span>
	</div>
</template>

<style scoped>
.head {
	position: relative;
	height: 30px;
	border-radius: var(--sheet-radius, 15px);
	background: rgb(20 25 32 / 0.85);
	box-shadow:
		inset 0 0 0 1px var(--color-border),
		0 4px 14px rgb(0 0 0 / 0.45);
	font: 400 11px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--color-text-faint);
}

/* The lane's ranks and the pills' labels centred on their columns. */
.head > span {
	text-align: center;
}

/* The first label starts where the names do: past the chevron (20 px) and its 6 px gap. */
.head > span:first-child {
	text-align: left;
	padding-left: 26px;
}

.axis {
	display: flex;
	text-transform: none;
	letter-spacing: 0;
	font-size: 11.5px;
}

.axis span {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-align: center;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
