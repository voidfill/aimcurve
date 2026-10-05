<script setup lang="ts">
/**
 * The difficulty's sheet (P2, P3, P9 of the benchmarks page design): one row
 * per tree node in tree order, every row on the same rank axis, and under any
 * row its folded-open history chart.
 *
 * The lanes' hatch patterns are defined here once and referenced by every
 * lane; each lane defines its own candle gradient (see `CandleLane`).
 *
 * The tree shows without indentation, and without words:
 * - each category is a block of its own, its row the block's tinted header
 *   and each subcategory a faint band inside it;
 * - in a narrow gutter left of the names, braces in the category's colour
 *   join each aggregate to the rows it is made of (see `lib/energy/brace`).
 *
 * A row is one control: clicking anywhere on it folds its chart open (the
 * chevron is the same toggle for the keyboard). A scenario's fold leads with
 * its concrete numbers and what to do next (`ScenarioFold`), so inspecting,
 * deciding and acting happen in one place.
 */
import { computed, type ComputedRef, useId } from 'vue';
import type { RankStep } from '../lib/benchmarks/snapshot';
import { chartColor } from '../lib/benchmarks/format';
import { hatchOpacity, laneColumns } from '../lib/energy/axis';
import { type BraceMark, braces, continuation } from '../lib/energy/brace';
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
}>();

const emit = defineEmits<{
	(event: 'toggle', key: string): void;
	(event: 'open-run', runId: number): void;
}>();

const defs = `lane-${useId()}`;
const columns = computed(() =>
	laneColumns(props.ranks).map((c) => ({ ...c, tint: chartColor(c.color), opacity: hatchOpacity(c.color) })),
);

/** Body height, pill height and pill font size per level, as in the approved board. */
const SIZES = {
	overall: { body: 14, pill: 28, font: 13.5 },
	category: { body: 12, pill: 26, font: 13 },
	subcategory: { body: 11, pill: 24, font: 12.5 },
	scenario: { body: 11, pill: 22, font: 12 },
} as const;

const rowByKey = computed(() => new Map(props.rows.map((r) => [r.key, r])));
const marks = computed(() => new Map(braces(props.rows).map((m, i) => [props.rows[i]!.key, m])));

function marksOf(row: BenchmarkRow): BraceMark[] {
	return marks.value.get(row.key) ?? [];
}

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

/** The overall on its own, then one block per category with all its rows. */
const blocks = computed(() => {
	const out: { key: string; rows: BenchmarkRow[] }[] = [];
	for (const row of props.rows) {
		if (row.level === 'overall' || row.level === 'category' || out.length === 0) out.push({ key: row.key, rows: [] });
		out[out.length - 1]!.rows.push(row);
	}
	return out;
});

function rowStyle(row: BenchmarkRow): Record<string, string> {
	return {
		'--pill-height': `${SIZES[row.level].pill}px`,
		'--pill-font': `${SIZES[row.level].font}px`,
		'--brace': row.color ? chartColor(row.color) : '#4a535c',
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
		<svg class="defs" width="0" height="0" aria-hidden="true">
			<defs>
				<pattern
					v-for="(c, i) in columns"
					:id="`${defs}-h${i}`"
					:key="c.name"
					width="6"
					height="6"
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<rect width="1.6" height="6" :fill="c.tint" :opacity="c.opacity" />
				</pattern>
			</defs>
		</svg>

		<div class="sheet" role="table" aria-label="Benchmark sheet">
			<div v-for="block in blocks" :key="block.key" class="block" :class="{ hero: block.key === 'overall' }" role="rowgroup">
				<!-- The column legend heads the overall's box: the overall's own row is the first one it labels. -->
				<div v-if="block.key === 'overall'" class="grid head" role="row">
					<span role="columnheader">Benchmark</span>
					<span class="axis" role="columnheader">
						<span v-for="c in columns" :key="c.name" :style="{ color: c.tint }">{{ c.name }}</span>
					</span>
					<span role="columnheader">PB</span>
					<span role="columnheader">Median · last {{ runWindow }}</span>
				</div>
				<template v-for="row in block.rows" :key="row.key">
					<div
						class="grid row"
						:class="[row.level, { stale: row.stale !== null }]"
						role="row"
						:style="rowStyle(row)"
						@click="emit('toggle', row.key)"
					>
						<span class="brace" aria-hidden="true">
							<i v-for="(m, c) in marksOf(row)" :key="c" :class="[m, `col${c}`]"></i>
						</span>
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
							:defs="defs"
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
						<span class="brace" aria-hidden="true">
							<i v-for="(m, c) in continuation(marksOf(row))" :key="c" :class="[m, `col${c}`]"></i>
						</span>
						<div role="cell" class="fold-cell">
							<ScenarioFold
								v-if="row.facts"
								:name="row.name"
								:facts="row.facts"
								:hash="row.hash"
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
.scroll {
	overflow-x: auto;
}

.defs {
	position: absolute;
	width: 0;
	height: 0;
	overflow: hidden;
}

.sheet {
	min-width: 760px;
}

.grid {
	display: grid;
	grid-template-columns: minmax(150px, 220px) minmax(0, 1fr) 150px 150px;
	column-gap: 16px;
	align-items: center;
	padding: 0 12px 0 34px;
}

.head {
	height: 30px;
	border-bottom: 1px solid var(--color-border);
	font: 400 11px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--color-text-faint);
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
	margin-bottom: 8px;
	border-radius: 6px;
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

/*
 * The brace gutter: column 0 at 9 px, column 1 at 19 px, elbows reaching
 * to 28 px, just short of the chevron.
 */
.brace {
	position: absolute;
	left: 0;
	top: 0;
	bottom: 0;
	width: 30px;
	pointer-events: none;
	color: var(--brace);
	opacity: 0.6;
}

.brace i {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 0;
}

.brace .col0 {
	left: 9px;
}

.brace .col1 {
	left: 19px;
}

/* The vertical: through, from the middle down, or from the top to the middle. */
.brace i::before {
	content: '';
	position: absolute;
	left: -0.75px;
	width: 1.5px;
	background: currentColor;
}

.brace .pass::before,
.brace .tee::before {
	top: 0;
	bottom: 0;
}

.brace .node::before {
	top: 50%;
	bottom: 0;
}

.brace .end::before {
	top: 0;
	bottom: 50%;
}

/* The elbow into a child, and the node on the parent. */
.brace i::after {
	content: '';
	position: absolute;
	top: 50%;
}

.brace .tee::after,
.brace .end::after {
	left: 0;
	width: calc(28px - var(--at));
	height: 1.5px;
	margin-top: -0.75px;
	background: currentColor;
}

.brace .col0 {
	--at: 9px;
}

.brace .col1 {
	--at: 19px;
}

.brace .node::after {
	left: -3px;
	width: 6px;
	height: 6px;
	margin-top: -3px;
	border-radius: 50%;
	background: currentColor;
}

.row.overall {
	height: 52px;
}

.row.category {
	height: 44px;
	background: color-mix(in srgb, var(--brace) 9%, #161a1e);
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
	padding: 6px 12px 12px 34px;
}

.fold-cell {
	background: var(--color-plot);
	border: 1px solid var(--color-border);
	border-radius: 3px;
	padding: 8px 8px 4px 0;
}

.fold-none {
	padding: 24px 12px;
	font: 400 12px/1.4 var(--font-mono);
	color: var(--color-text-faint);
}
</style>
