<script setup lang="ts">
/**
 * The bot breakdown (Run view R6): per kill slot for a race, per bot for a
 * clock run. Hovering or focusing a row highlights its encounters in the chart,
 * and clicking or Enter pins that highlight.
 *
 * Every figure is an observation: the table never says why a bot went badly.
 */
import { computed } from 'vue';
import type { ClockTable, RaceTable } from '../lib/run/bots';
import { largestLoss } from '../lib/run/bots';
import { formatSigned, formatValue } from '../lib/run/format';

export type BotTableData = { kind: 'race'; table: RaceTable } | { kind: 'clock'; table: ClockTable };

const props = defineProps<{
	data: BotTableData;
	colors: Map<string, string>;
	/** The baseline's label, or null when there is none. */
	baselineLabel: string | null;
	/** The baseline has a score but no per-bot detail. */
	baselineFlat: boolean;
	/** The highlighted row's key: the slot for a race, the bot for a clock run. */
	active: string | null;
	pinned: string | null;
}>();

const emit = defineEmits<{
	(event: 'hover', key: string | null): void;
	(event: 'toggle', key: string): void;
}>();

const DASH = '—';

interface Cell {
	text: string;
	tone?: 'ahead' | 'behind' | 'dim' | 'strong';
}

interface Row {
	key: string;
	bot: string;
	cells: Cell[];
}

/** Dead time: time that belongs to no killed bot. */
interface Extra {
	label: string;
	cells: Cell[];
}

function signed(delta: number | null, digits: number): Cell {
	if (delta === null) return { text: DASH, tone: 'dim' };
	return { text: formatSigned(delta, digits), tone: delta > 0 ? 'ahead' : delta < 0 ? 'behind' : 'dim' };
}

const baseHeader = computed(() => props.baselineLabel ?? 'baseline');

const columns = computed(() =>
	props.data.kind === 'race'
		? ['this run', 'pace', baseHeader.value, 'Δ', 'best', 'Δ best']
		: ['engaged', 'enc.', 'hits / shots', 'acc', 'points', 'pace', `Δ ${baseHeader.value}`],
);

const noDelta = computed(() => props.baselineFlat || props.baselineLabel === null);

const rows = computed<Row[]>(() => {
	if (props.data.kind === 'race') {
		return props.data.table.rows.map((row) => ({
			key: String(row.slot),
			bot: row.bot,
			cells: [
				{ text: formatValue(row.split, 2), tone: 'strong' },
				{ text: formatValue(row.pace, 2), tone: 'dim' },
				row.baseline === null || noDelta.value ? { text: DASH, tone: 'dim' } : { text: formatValue(row.baseline, 2), tone: 'dim' },
				noDelta.value ? { text: DASH, tone: 'dim' } : signed(row.delta, 2),
				{ text: formatValue(row.best, 2), tone: 'dim' },
				signed(row.deltaBest, 2),
			],
		}));
	}
	return props.data.table.rows.map((row) => ({
		key: row.bot,
		bot: row.bot,
		cells: [
			{ text: `${formatValue(row.time, 2)} s`, tone: 'dim' },
			{ text: formatValue(row.encounters), tone: 'dim' },
			{ text: `${formatValue(row.hits)} / ${formatValue(row.shots)}`, tone: 'dim' },
			{ text: row.accuracy === null ? DASH : `${formatValue(row.accuracy * 100, 1)}%`, tone: 'strong' },
			{ text: formatValue(row.points, 1), tone: 'strong' },
			{ text: row.pace === null ? DASH : formatValue(row.pace, 0), tone: 'dim' },
			noDelta.value ? { text: DASH, tone: 'dim' } : signed(row.delta, 1),
		],
	}));
});

const worst = computed(() => {
	if (noDelta.value) return null;
	const deltas: readonly { delta: number | null }[] = props.data.table.rows;
	const i = largestLoss(deltas);
	return i === null ? null : rows.value[i]!.key;
});

/** The Δ column the largest loss is emphasised in. */
const deltaColumn = computed(() => (props.data.kind === 'race' ? 3 : 6));

const extras = computed<Extra[]>(() => {
	const dim = (text: string): Cell => ({ text, tone: 'dim' });
	if (props.data.kind === 'race') {
		const { dead } = props.data.table;
		return [
			{
				label: 'dead time',
				cells: [
					dim(formatValue(dead.split, 2)),
					dim(DASH),
					dim(dead.baseline === null || noDelta.value ? DASH : formatValue(dead.baseline, 2)),
					noDelta.value ? dim(DASH) : signed(dead.delta, 2),
					dim(DASH),
					dim(DASH),
				],
			},
		];
	}
	const { dead, rows: list } = props.data.table;
	if (list.length === 0) return [];
	return [
		{
			label: 'dead time',
			cells: [dim(`${formatValue(dead.time, 2)} s`), dim(DASH), dim(DASH), dim(DASH), dim(formatValue(dead.points, 1)), dim(DASH), dim(DASH)],
		},
	];
});

const title = computed(() => (props.data.kind === 'race' ? 'Per-bot splits' : 'Bot breakdown'));

const subtitle = computed(() => {
	const parts: string[] = [];
	if (props.data.kind === 'race') {
		parts.push('seconds engaged per bot (kill − TTK → kill); dead time between bots apart; pace = race time at this split');
	} else parts.push('engaged from kill − TTK to the kill; points gained while engaged; pace = run score at this rate');
	if (props.baselineFlat && props.baselineLabel) parts.push(`${props.baselineLabel} has no per-bot detail`);
	else if (props.baselineLabel === null) parts.push('no baseline to compare with');
	return parts.join(' · ');
});

function onKey(event: KeyboardEvent, key: string): void {
	if (event.key === 'Enter' || event.key === ' ') {
		event.preventDefault();
		emit('toggle', key);
	}
}
</script>

<template>
	<section class="bots" aria-labelledby="bots-heading">
		<header>
			<h2 id="bots-heading">{{ title }}</h2>
			<span class="sub">{{ subtitle }}</span>
			<span class="hint">hover a row to isolate it in the chart · click to pin</span>
		</header>
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th scope="col" class="name">bot</th>
						<th v-for="column in columns" :key="column" scope="col">{{ column }}</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="row in rows"
						:key="row.key"
						tabindex="0"
						:class="{ on: active === row.key || pinned === row.key, pinned: pinned === row.key }"
						@mouseenter="emit('hover', row.key)"
						@mouseleave="emit('hover', null)"
						@focus="emit('hover', row.key)"
						@blur="emit('hover', null)"
						@click="emit('toggle', row.key)"
						@keydown="onKey($event, row.key)"
					>
						<th scope="row" class="name">
							<i class="swatch" :style="{ background: colors.get(row.bot) }" aria-hidden="true"></i>{{ row.bot }}
						</th>
						<td
							v-for="(cell, i) in row.cells"
							:key="i"
							:class="[cell.tone, { worst: worst === row.key && i === deltaColumn }]"
						>
							{{ cell.text }}
						</td>
					</tr>
					<tr v-for="extra in extras" :key="extra.label" class="tail">
						<th scope="row" class="name"><i class="swatch" aria-hidden="true"></i>{{ extra.label }}</th>
						<td v-for="(cell, i) in extra.cells" :key="i" :class="cell.tone">{{ cell.text }}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>
</template>

<style scoped>
.bots {
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: 3px;
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
}

header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 14px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--color-border);
}

h2 {
	font: 500 11px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.15em;
	color: #c3c9cf;
}

.sub,
.hint {
	font: 400 11px/1.2 var(--font-mono);
	color: var(--color-text-faint);
}

.hint {
	margin-left: auto;
}

.scroll {
	flex: 1 1 auto;
	min-height: 0;
	overflow: auto;
	/* Columns keep their width whether or not the rows overflow. */
	scrollbar-gutter: stable;
}

table {
	width: 100%;
	border-collapse: collapse;
}

/* Pinned while the rows scroll, over the panel's own background. */
thead th {
	position: sticky;
	top: 0;
	z-index: 1;
	background: var(--color-surface);
	text-align: right;
	font: 400 9.5px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.13em;
	color: var(--color-text-faint);
	padding: 6px 12px 7px;
	white-space: nowrap;
}

th.name {
	text-align: left;
}

tbody tr {
	cursor: pointer;
}

tbody tr:focus-visible {
	outline-offset: -2px;
}

tbody tr.on {
	background: #171c21;
	box-shadow: inset 2px 0 0 var(--color-accent);
}

tbody th,
td {
	padding: 6px 12px;
	border-bottom: 1px solid var(--color-rule-faint);
	font: 400 12.5px/1 var(--font-mono);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

tbody th {
	font-weight: 400;
	color: var(--color-text);
}

tr.on th {
	color: var(--color-text-strong);
}

td {
	text-align: right;
	color: var(--color-text);
}

.swatch {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 2px;
	margin-right: 8px;
	background: var(--color-border-strong);
}

.dim {
	color: #a2a9b0;
}

.strong {
	color: var(--color-text);
}

.ahead {
	color: var(--color-ahead);
}

.behind {
	color: var(--color-behind);
}

.worst {
	font-weight: 700;
}

tr.tail {
	cursor: default;
}

tr.tail th,
tr.tail td {
	color: var(--color-text-faint);
}
</style>
