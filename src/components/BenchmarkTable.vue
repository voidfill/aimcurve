<script setup lang="ts">
/**
 * The difficulty's sheet (P2, P3, P9 of the benchmarks page design): one row
 * per tree node in tree order, every row on the same rank axis, and under any
 * row its folded-open history chart.
 *
 * The lanes' hatch patterns are defined here once and referenced by every
 * lane; each lane defines its own candle gradient (see `CandleLane`).
 */
import { computed, type ComputedRef, useId } from 'vue';
import type { RankStep } from '../lib/benchmarks/snapshot';
import { chartColor } from '../lib/benchmarks/format';
import { hatchOpacity, laneColumns } from '../lib/energy/axis';
import type { RowChart } from '../lib/energy/chart';
import type { BenchmarkRow } from '../composables/useBenchmarkPage';
import CandleLane from './CandleLane.vue';
import ProgressChart from './ProgressChart.vue';
import RankPill from './RankPill.vue';

const props = defineProps<{
	rows: readonly BenchmarkRow[];
	ranks: readonly RankStep[];
	/** Keys of the rows whose chart is open. */
	open: ReadonlySet<string>;
	chartFor: (row: BenchmarkRow, dateAxis: boolean) => RowChart | null;
	dateAxis: boolean;
	/** `W`, for the median pill's label. */
	candleWindow: number;
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

/**
 * One cached chart per open row. It depends on what `chartFor` reads of the
 * row, reduced to a string, so a new rows array with the same row (another
 * candle window, another row toggled) keeps the chart instead of rebuilding it
 * and resetting every open plot.
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

function emptyText(row: BenchmarkRow): string | null {
	return row.state === 'unrated' ? 'unrated · no ladder on this difficulty' : row.state === 'unplayed' ? 'not played' : null;
}

function chartTitle(row: BenchmarkRow): string {
	return row.rule === null
		? `${row.name} · every completed run, all versions of the name`
		: `${row.name} · custom energy, the ${row.rule}`;
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
			<div class="grid head" role="row">
				<span role="columnheader">Benchmark</span>
				<span class="axis" role="columnheader">
					<span v-for="c in columns" :key="c.name" :style="{ color: c.tint }">{{ c.name }}</span>
				</span>
				<span role="columnheader">PB</span>
				<span role="columnheader">Median · last {{ candleWindow }}</span>
			</div>

			<template v-for="row in rows" :key="row.key">
				<div
					class="grid row"
					:class="[row.level, { stale: row.stale !== null }]"
					role="row"
					:style="{ '--pill-height': `${SIZES[row.level].pill}px`, '--pill-font': `${SIZES[row.level].font}px` }"
				>
					<span class="name" role="rowheader">
						<button
							type="button"
							class="chevron"
							:class="{ on: open.has(row.key) }"
							:aria-expanded="open.has(row.key)"
							:aria-label="`${open.has(row.key) ? 'Hide' : 'Show'} ${row.name} history`"
							@click="emit('toggle', row.key)"
						>
							<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3" /></svg>
						</button>
						<button type="button" class="label" tabindex="-1" @click="emit('toggle', row.key)">{{ row.name }}</button>
						<span v-if="row.stale" class="age" :title="`Last played ${row.stale}`">{{ row.stale }}</span>
						<RouterLink
							v-if="row.hash"
							class="go"
							:to="{ name: 'scenario', params: { hash: row.hash } }"
							:aria-label="`Open ${row.name}'s scenario page`"
							title="Open the scenario page"
						>
							<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5h5v5M9.5 2.5l-7 7" /></svg>
						</RouterLink>
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
						<RankPill :r="row.spread?.median ?? null" :ranks="ranks" :label="`${row.name} median of last ${candleWindow}`" />
					</span>
				</div>

				<div v-if="open.has(row.key)" class="fold" role="row">
					<div role="cell" class="fold-cell">
						<p class="fold-title">{{ chartTitle(row) }}</p>
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
						<p v-else class="fold-none">No runs to chart yet.</p>
					</div>
				</div>
			</template>
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
	padding: 4px 16px 10px;
}

.grid {
	display: grid;
	grid-template-columns: minmax(150px, 220px) minmax(0, 1fr) 150px 150px;
	column-gap: 16px;
	align-items: center;
}

.head {
	height: 34px;
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

.row {
	height: 36px;
}

.row.overall {
	height: 52px;
	margin: 0 -16px;
	padding: 0 16px;
	background: #141920;
	border-radius: 3px;
}

.row.category {
	height: 44px;
	border-top: 1px solid var(--color-border-strong);
}

.row.subcategory {
	height: 38px;
	border-top: 1px solid #1a1e22;
}

.name {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

.subcategory .name {
	padding-left: 16px;
}

.scenario .name {
	padding-left: 32px;
}

.label {
	min-width: 0;
	flex: 0 1 auto;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	border: 0;
	padding: 0;
	background: transparent;
	text-align: left;
	cursor: pointer;
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

.label:hover {
	color: var(--color-text-strong);
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

.chevron:focus-visible,
.go:focus-visible {
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

.go {
	display: flex;
	flex: none;
	color: var(--color-text-faint);
	border-radius: 3px;
}

.go:hover {
	color: var(--color-accent);
}

.go svg {
	width: 12px;
	height: 12px;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.4;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.dim {
	opacity: 0.5;
}

.fold {
	padding: 6px 0 12px;
}

.fold-cell {
	background: var(--color-plot);
	border: 1px solid var(--color-border);
	border-radius: 3px;
	padding: 8px 8px 4px 0;
}

.fold-title {
	padding: 0 0 6px 12px;
	font: 400 11px/1.3 var(--font-mono);
	color: var(--color-text-muted);
}

.fold-none {
	padding: 24px 12px;
	font: 400 12px/1.4 var(--font-mono);
	color: var(--color-text-faint);
}
</style>
