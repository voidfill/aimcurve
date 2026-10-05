<script setup lang="ts">
/**
 * The scenario's row from its benchmark's sheet, on the scenario page: the
 * same legend, candle lane and pills, from the same model (`useBenchmarkPage`),
 * so it always reads exactly as the sheet does. Its name cell is the
 * scenario's, as on the sheet, with where it sits in the benchmark under it;
 * it links to the sheet at this very row, folded open.
 *
 * The values are the benchmark's: every version of the name, as on the sheet,
 * not only the version this page shows.
 */
import { computed } from 'vue';
import { useBenchmarkPage } from '../composables/useBenchmarkPage';
import { useRunWindow } from '../composables/useChartSettings';
import RowCells from './RowCells.vue';
import SheetLegend from './SheetLegend.vue';

const props = defineProps<{
	benchmarkId: number;
	/** The scenario's name, as in the benchmark (trimmed). */
	name: string;
}>();

const runWindow = useRunWindow();
const page = useBenchmarkPage(
	computed(() => props.benchmarkId),
	{ runWindow },
);

const row = computed(() => page.rows.value.find((r) => r.level === 'scenario' && r.name === props.name.trim()) ?? null);
const byKey = computed(() => new Map(page.rows.value.map((r) => [r.key, r])));

/** Where the scenario sits: its category (unless the only one) and subcategory, as shown on the sheet. */
const place = computed(() => {
	const r = row.value;
	if (r === null) return null;
	const names = r.parents
		.map((k) => byKey.value.get(k))
		.filter((p) => p !== undefined && p.level !== 'overall')
		.map((p) => p!.name);
	return names.length ? `in ${names.join(' › ')}` : null;
});

/** The sheet, at this scenario's own row, folded open. */
const sheetRow = computed(() =>
	row.value === null ? null : { name: 'benchmark', params: { id: props.benchmarkId }, query: { open: row.value.key } },
);
</script>

<template>
	<section v-if="row && page.tree.value" class="bench" aria-label="Benchmark standing">
		<SheetLegend :ranks="page.tree.value.ranks" :run-window="runWindow" first="Scenario" />
		<div class="sheet-grid row">
			<RouterLink :to="sheetRow!" class="where" title="Open this row on the benchmark sheet">
				<span class="name">{{ row.name }}</span>
				<span v-if="place" class="place">{{ place }}</span>
			</RouterLink>
			<RowCells :row="row" :ranks="page.tree.value.ranks" :run-window="runWindow" :size="12" />
		</div>
	</section>
</template>

<style scoped>
.bench {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.row {
	height: 48px;
	border-radius: 15px;
	background: #13171b;
	box-shadow: inset 0 0 0 1px var(--color-border);
	--pill-height: 26px;
	--pill-font: 13px;
}

/* Aligned with the legend's first label, past where a chevron would be. */
.where {
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
	padding-left: 26px;
	text-decoration: none;
}

.name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font: 400 13px/1.2 var(--font-sans);
	color: var(--color-text);
}

.where:hover .name {
	color: var(--color-accent);
}

.place {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font: 400 11px/1.2 var(--font-mono);
	color: var(--color-text-faint);
}
</style>
