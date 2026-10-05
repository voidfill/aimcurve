<script setup lang="ts">
/**
 * One benchmark row's value cells in `.sheet-grid`: the candle lane, then the
 * PB and median pills. The Benchmarks sheet draws every row with them, the
 * scenario page its scenario's row; the name cell before them is the caller's.
 * Pill sizes come from the row's `--pill-height` and `--pill-font`.
 */
import type { BenchmarkRow } from '../composables/useBenchmarkPage';
import type { RankStep } from '../lib/benchmarks/snapshot';
import { laneTip } from '../lib/arc/tip';
import CandleLane from './CandleLane.vue';
import RankPill from './RankPill.vue';

defineProps<{
	row: BenchmarkRow;
	ranks: readonly RankStep[];
	/** The run window, for the median pill's label. */
	runWindow: number;
	/** The candle body's height in px. */
	size: number;
	/** Epoch ms the tooltip measures "last played" from; now by default. */
	now?: number;
}>();

function emptyText(row: BenchmarkRow): string | null {
	return row.state === 'unrated' ? 'unrated · no ladder on this difficulty' : row.state === 'unplayed' ? 'not played' : null;
}
</script>

<template>
	<CandleLane
		role="cell"
		:ranks="ranks"
		:spread="row.spread"
		:body="row.body"
		:ticks="row.ticks"
		:empty="emptyText(row)"
		:size="size"
		:dim="row.stale !== null"
		:name="row.name"
		:tip="() => laneTip(row, ranks, now ?? Date.now())"
	/>
	<span role="cell"><RankPill :r="row.spread?.pb ?? null" :ranks="ranks" :label="`${row.name} PB`" /></span>
	<span role="cell" :class="{ dim: row.stale !== null }">
		<RankPill :r="row.spread?.median ?? null" :ranks="ranks" :label="`${row.name} median of last ${runWindow}`" />
	</span>
</template>

<style scoped>
/* A stale scenario's median fades with its candle; its PB stays. */
.dim {
	opacity: 0.5;
}
</style>
