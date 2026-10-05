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
 *
 * It stands in for the header's PB rank, so it always says something: a
 * placeholder of the same height while loading, and why when it cannot show.
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
// Only this scenario's runs: its row is all this page shows.
const page = useBenchmarkPage(
	computed(() => props.benchmarkId),
	{ runWindow, only: computed(() => [props.name.trim()]), flat: true },
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

/** The sheet, at this scenario's own row, folded open; none for a difficulty without a sheet. */
const sheetRow = computed(() =>
	row.value === null || page.benchmark.value?.tree == null
		? null
		: { name: 'benchmark', params: { id: props.benchmarkId }, query: { open: row.value.key } },
);
</script>

<template>
	<section class="bench" aria-label="Benchmark standing">
		<template v-if="row && page.tree.value">
			<SheetLegend :ranks="page.tree.value.ranks" :run-window="runWindow" first="Scenario" />
			<div class="sheet-grid row">
				<component
					:is="sheetRow ? 'RouterLink' : 'span'"
					:to="sheetRow ?? undefined"
					class="where"
					:title="sheetRow ? 'Open this row on the benchmark sheet' : undefined"
				>
					<span class="name">{{ row.name }}</span>
					<span v-if="place" class="place">{{ place }}</span>
				</component>
				<RowCells :row="row" :ranks="page.tree.value.ranks" :run-window="runWindow" :size="12" />
			</div>
		</template>
		<p v-else-if="page.state.value === 'error'" class="row note" role="alert">
			The benchmark standing could not be read. {{ page.error.value }}
			<button type="button" @click="page.retry()">Try again</button>
		</p>
		<p v-else-if="page.state.value === 'ready'" class="row note">This scenario is not on this benchmark's sheet.</p>
		<p v-else class="row note" aria-busy="true">Loading the benchmark standing…</p>
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

a.where:hover .name {
	color: var(--color-accent);
}

.note {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 0 12px 0 38px;
	font: 400 11.5px/1.3 var(--font-mono);
	color: var(--color-text-faint);
}

.note button {
	padding: 3px 9px;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	background: transparent;
	color: var(--color-text-muted);
	font: inherit;
	cursor: pointer;
}

.note button:hover {
	border-color: var(--color-accent);
}

.place {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font: 400 11px/1.2 var(--font-mono);
	color: var(--color-text-faint);
}
</style>
