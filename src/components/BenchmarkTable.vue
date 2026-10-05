<script setup lang="ts">
/**
 * The difficulty's sheet (P2, P3, P9 of the benchmarks page design): one row
 * per tree node in tree order, every row on the same rank axis, and under any
 * row its folded-open history chart.
 *
 *
 * The tree shows without indentation, and without words:
 * - each category is a block of its own, its row the block's tinted header
 *   and each subcategory a faint band inside it;
 * - level shows in the type: the overall largest, categories bold,
 *   subcategories semibold, scenarios regular and lighter.
 *
 * A row is one control: clicking anywhere on it folds its chart open (the
 * chevron is the same toggle for the keyboard). A scenario's fold leads with
 * its concrete numbers and what to do next (`ScenarioFold`), so inspecting,
 * deciding and acting happen in one place.
 */
import { computed, type ComputedRef } from 'vue';
import type { RankStep } from '../lib/benchmarks/snapshot';
import { chartColor } from '../lib/benchmarks/format';
import { laneColumns } from '../lib/energy/axis';
import type { RowChart } from '../lib/energy/chart';
import type { BenchmarkRow } from '../composables/useBenchmarkPage';
import CandleLane from './CandleLane.vue';
import ProgressChart from './ProgressChart.vue';
import RankPill from './RankPill.vue';
import ScenarioFold from './ScenarioFold.vue';

const props = defineProps<{
	rows: readonly BenchmarkRow[];
	ranks: readonly RankStep[];
	/** Keys of the rows whose chart is open. */
	open: ReadonlySet<string>;
	chartFor: (row: BenchmarkRow, dateAxis: boolean) => RowChart | null;
	dateAxis: boolean;
	/** The run window, for the median pill's label. */
	runWindow: number;
	/** The difficulty's KovaaK's benchmark ID, for links out. */
	benchmarkId: number;
}>();

const emit = defineEmits<{
	(event: 'toggle', key: string): void;
	(event: 'open-run', runId: number): void;
}>();

const columns = computed(() => laneColumns(props.ranks).map((c) => ({ ...c, tint: chartColor(c.color) })));

/** Body height, pill height and pill font size per level, as in the approved board. */
const SIZES = {
	overall: { body: 14, pill: 28, font: 13.5 },
	category: { body: 12, pill: 26, font: 13 },
	subcategory: { body: 11, pill: 24, font: 12.5 },
	scenario: { body: 11, pill: 22, font: 12 },
} as const;

const rowByKey = computed(() => new Map(props.rows.map((r) => [r.key, r])));


/**
 * One cached chart per open row. It depends on what `chartFor` reads of the
 * row, reduced to a string, so a new rows array with the same row (another
 * window, another row toggled) keeps the chart instead of rebuilding it and
 * resetting every open plot.
 */
const cache = new Map<string, ComputedRef<RowChart | null>>();

function chartOf(key: string): ComputedRef<RowChart | null> {
	let chart = cache.get(key);
	if (!chart) {
		const what = computed(() => {
			const r = rowByKey.value.get(key);
			return r ? JSON.stringify({ key, level: r.level, name: r.name, node: r.node, scenario: r.scenario, state: r.state }) : null;
		});
		chart = computed(() => (what.value === null ? null : props.chartFor(JSON.parse(what.value) as BenchmarkRow, props.dateAxis)));
		cache.set(key, chart);
	}
	return chart;
}

const charts = computed(() => {
	for (const key of cache.keys()) if (!props.open.has(key)) cache.delete(key);
	const out = new Map<string, RowChart | null>();
	for (const key of props.open) out.set(key, chartOf(key).value);
	return out;
});

/**
 * The overall on its own, then one block per category with all its rows, by
 * the category a row belongs to: a lone category has no row of its own.
 */
const blocks = computed(() => {
	const out: { key: string; rows: BenchmarkRow[] }[] = [];
	for (const row of props.rows) {
		const key = row.level === 'overall' ? 'overall' : row.level === 'category' ? row.key : row.parents[1]!;
		if (out[out.length - 1]?.key !== key) out.push({ key, rows: [] });
		out[out.length - 1]!.rows.push(row);
	}
	return out;
});

function rowStyle(row: BenchmarkRow): Record<string, string> {
	return {
		'--pill-height': `${SIZES[row.level].pill}px`,
		'--pill-font': `${SIZES[row.level].font}px`,
		'--tint': row.color ? chartColor(row.color) : '#4a535c',
	};
}

function emptyText(row: BenchmarkRow): string | null {
	return row.state === 'unrated' ? 'unrated · no ladder on this difficulty' : row.state === 'unplayed' ? 'not played' : null;
}

function onOpen(row: BenchmarkRow, index: number): void {
	const id = charts.value.get(row.key)?.runIds?.[index];
	if (id !== undefined) emit('open-run', id);
}
</script>

<template>
	<div class="scroll">

		<div class="sheet" role="table" aria-label="Benchmark sheet">
			<!--
				The column legend reads as the top of the overall's box, but is the
				sheet's own child, so it can pin under the header bar for the whole
				sheet while the overall's row and chart scroll away beneath it.
			-->
			<div class="pin">
				<div class="grid head" role="row">
					<span role="columnheader">Benchmark</span>
					<span class="axis" role="columnheader">
						<span v-for="c in columns" :key="c.name" :style="{ color: c.tint }">{{ c.name }}</span>
					</span>
					<span role="columnheader">PB</span>
					<span role="columnheader">Median · last {{ runWindow }}</span>
				</div>
			</div>

			<div v-for="block in blocks" :key="block.key" class="block" :class="{ hero: block.key === 'overall' }" role="rowgroup">
				<template v-for="row in block.rows" :key="row.key">
					<div
						class="grid row"
						:class="[row.level, { stale: row.stale !== null }]"
						role="row"
						:style="rowStyle(row)"
						@click="emit('toggle', row.key)"
					>
						<span class="name" role="rowheader">
							<button
								type="button"
								class="chevron"
								:class="{ on: open.has(row.key) }"
								:aria-expanded="open.has(row.key)"
								:aria-label="`${open.has(row.key) ? 'Hide' : 'Show'} ${row.name}`"
								@click.stop="emit('toggle', row.key)"
							>
								<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3" /></svg>
							</button>
							<span class="label" :title="row.name">{{ row.name }}</span>
							<span v-if="row.stale" class="age" :title="`Last played ${row.stale}`">{{ row.stale }}</span>
						</span>
						<CandleLane
							role="cell"
							:ranks="ranks"
							:spread="row.spread"
							:body="row.body"
							:ticks="row.ticks"
							:empty="emptyText(row)"
							:size="SIZES[row.level].body"
							:dim="row.stale !== null"
							:name="row.name"
						/>
						<span role="cell"><RankPill :r="row.spread?.pb ?? null" :ranks="ranks" :label="`${row.name} PB`" /></span>
						<span role="cell" :class="{ dim: row.stale !== null }">
							<RankPill :r="row.spread?.median ?? null" :ranks="ranks" :label="`${row.name} median of last ${runWindow}`" />
						</span>
					</div>

					<div v-if="open.has(row.key)" class="fold" role="row" :style="rowStyle(row)">
						<div role="cell" class="fold-cell">
							<ScenarioFold
								v-if="row.facts"
								:name="row.name"
								:facts="row.facts"
								:hash="row.hash"
								:benchmark-id="benchmarkId"
								:unrated="row.state === 'unrated'"
							/>
							<ProgressChart
								v-if="charts.get(row.key)"
								:x="charts.get(row.key)!.x"
								:date-axis="dateAxis"
								:y="charts.get(row.key)!.y"
								:best="charts.get(row.key)!.best"
								:median="charts.get(row.key)!.median"
								:median-full="charts.get(row.key)!.medianFull"
								:breaks="[]"
								:colors="charts.get(row.key)!.colors"
								:highlight="null"
								:ranks="charts.get(row.key)!.ranks"
								:format-y="charts.get(row.key)!.formatY"
								:tip-for="charts.get(row.key)!.tipFor"
								:label="charts.get(row.key)!.label"
								:every-point="charts.get(row.key)!.runIds === null"
								@open="onOpen(row, $event)"
							/>
							<p v-else-if="!row.facts" class="fold-none">No runs to chart yet.</p>
						</div>
					</div>
				</template>
			</div>
		</div>
	</div>
</template>

<style scoped>
/*
 * Below the sheet's minimum width it scrolls sideways in its own box. Only
 * there: a scrolling box would become the column legend's sticky container,
 * and it would no longer pin to the page.
 */
@media (max-width: 820px) {
	.scroll {
		overflow-x: auto;
	}
}

.sheet {
	/* The one vertical spacing between the legend and every box. */
	--sheet-space: 10px;
	/* One corner radius for the legend and every box: half the legend's height, so it stays a full pill. */
	--sheet-radius: 15px;
	min-width: 760px;
}

.grid {
	display: grid;
	grid-template-columns: minmax(150px, 220px) minmax(0, 1fr) 150px 150px;
	column-gap: 16px;
	align-items: center;
	padding: 0 12px;
}

/*
 * The column legend: a long pill of its own that pins 5 px under the header
 * bar for the whole sheet. Behind it, one blur layer spans the gap up to the
 * bar, the pill itself, and a band below that fades out, so rows read as
 * passing under it rather than being cut off. The fade is as tall as the
 * sheet's one spacing, so at rest it ends at the overall box's edge rather
 * than blurring into it. The blur sits on the wrapper,
 * not the pill: an element with a backdrop filter only blurs its own content
 * for anything inside it.
 */
.pin {
	--gap: 5px;
	--fade: var(--sheet-space);
	position: sticky;
	top: calc(var(--bar-h, 0px) + var(--gap));
	z-index: 2;
	margin-bottom: var(--sheet-space);
}

.pin::before {
	content: '';
	position: absolute;
	left: 0;
	right: 0;
	top: calc(-1 * var(--gap));
	bottom: calc(-1 * var(--fade));
	backdrop-filter: blur(6px);
	mask-image: linear-gradient(to bottom, #000 calc(100% - var(--fade)), transparent);
	pointer-events: none;
}

.head {
	position: relative;
	height: 30px;
	border-radius: var(--sheet-radius);
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

/* "Benchmark" starts where the names do: past the chevron (20 px) and its 6 px gap. */
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

/* Containment: the overall's hero band, then one raised block per category. */
.block {
	margin-bottom: var(--sheet-space);
	border-radius: var(--sheet-radius);
	overflow: hidden;
	background: #13171b;
	box-shadow: inset 0 0 0 1px var(--color-border);
}

.block.hero {
	background: #141920;
}

.row {
	position: relative;
	height: 36px;
	cursor: pointer;
}

.row:hover .label {
	color: var(--color-text-strong);
}

.row.overall {
	height: 52px;
}

.row.category {
	height: 44px;
	background: color-mix(in srgb, var(--tint) 9%, #161a1e);
}

.row.subcategory {
	height: 38px;
	background: color-mix(in srgb, var(--color-text) 3%, transparent);
}

.name {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

.label {
	min-width: 0;
	flex: 0 1 auto;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font: 400 13px/1.2 var(--font-sans);
	color: #a9b0b7;
}

.overall .label {
	font-size: 17px;
	font-weight: 700;
	color: var(--color-text-strong);
}

.category .label {
	font-size: 15px;
	font-weight: 650;
	color: var(--color-text);
}

.subcategory .label {
	font-size: 13.5px;
	font-weight: 600;
	color: #d5d9dd;
}

.chevron {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	border: 0;
	border-radius: 3px;
	padding: 0;
	background: transparent;
	color: var(--color-text-faint);
	cursor: pointer;
}

.chevron:hover {
	color: var(--color-text);
	background: color-mix(in srgb, var(--color-text) 7%, transparent);
}

.chevron:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 1px;
}

.chevron svg {
	width: 10px;
	height: 10px;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.6;
	stroke-linecap: round;
	stroke-linejoin: round;
	transition: transform 140ms ease;
}

.chevron.on svg {
	transform: rotate(90deg);
}

.age {
	flex: none;
	font: 400 11px/1 var(--font-mono);
	color: var(--color-text-faint);
	white-space: nowrap;
}

.dim {
	opacity: 0.5;
}

.fold {
	position: relative;
	padding: 6px 12px 12px;
}

.fold-cell {
	background: var(--color-plot);
	border: 1px solid var(--color-border);
	/* Nested in a box: a smaller radius, so its corners sit inside the box's. */
	border-radius: calc(var(--sheet-radius) - 6px);
	padding: 8px 8px 4px 0;
}

.fold-none {
	padding: 24px 12px;
	font: 400 12px/1.4 var(--font-mono);
	color: var(--color-text-faint);
}
</style>
