<script setup lang="ts">
/**
 * The Scenarios directory's table (L2, L3, L6 of its design): one row per
 * scenario version, in the order given. Clicking a row or pressing Enter on it
 * opens the scenario page; the name is also a real link, for middle-click and
 * copy-link, but it is out of the tab order so each row is one stop.
 */
import { useRouter } from 'vue-router';
import { formatScore, formatSigned, formatValue, timeFormat } from '../lib/run/format';
import type { DirectoryRow, PbRank, SortDir, SortKey } from '../lib/scenario/directory';
import { formatSince } from '../lib/scenario/format';

defineProps<{
	rows: readonly DirectoryRow[];
	ranks: ReadonlyMap<string, PbRank>;
	sort: SortKey;
	dir: SortDir;
	/** The selected benchmark's label, when one overrides the picks (L8). */
	benchLabel: string | null;
}>();

const emit = defineEmits<{ sort: [key: SortKey] }>();

const router = useRouter();

const DASH = '—';

const COLUMNS: { key: SortKey; label: string; left?: boolean }[] = [
	{ key: 'name', label: 'scenario', left: true },
	{ key: 'rank', label: 'rank', left: true },
	{ key: 'pb', label: 'PB' },
	{ key: 'form', label: 'recent form' },
	{ key: 'runs', label: 'runs' },
	{ key: 'played', label: 'last played' },
];

function to(row: DirectoryRow) {
	return { name: 'scenario', params: { hash: row.hash } };
}

function open(row: DirectoryRow, event: Event): void {
	// A click on the link itself is the link's to handle.
	if (event.target instanceof Element && event.target.closest('a')) return;
	void router.push(to(row));
}

function formatGap(gap: number): string {
	return `${formatSigned(Math.round(gap * 100))}%`;
}

function played(iso: string): string {
	const since = formatSince(iso, new Date());
	return since === 'today' ? 'today' : `${since} ago`;
}

function ariaSort(key: SortKey, sort: SortKey, dir: SortDir) {
	if (key !== sort) return undefined;
	return dir === 'asc' ? 'ascending' : 'descending';
}
</script>

<template>
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th
						v-for="col in COLUMNS"
						:key="col.key"
						scope="col"
						:class="{ left: col.left }"
						:aria-sort="ariaSort(col.key, sort, dir)"
						:title="col.key === 'rank' ? (benchLabel ? `Ranks on ${benchLabel}` : 'Ranks on each scenario’s picked benchmark') : undefined"
					>
						<button type="button" :class="{ active: col.key === sort }" @click="emit('sort', col.key)">
							{{ col.label }}<span class="arrow" aria-hidden="true">{{
								col.key === sort ? (dir === 'asc' ? '↑' : '↓') : ''
							}}</span>
						</button>
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.hash" tabindex="0" @click="open(row, $event)" @keydown.enter.self="open(row, $event)">
					<th scope="row" class="left name">
						<RouterLink :to="to(row)" tabindex="-1">{{ row.name }}</RouterLink>
						<span v-if="row.tag" class="tag">{{ row.tag }}</span>
					</th>
					<td class="left">
						<template v-if="ranks.get(row.hash)"
							><i
								v-if="ranks.get(row.hash)!.color"
								class="dot"
								:style="{ background: ranks.get(row.hash)!.color! }"
								aria-hidden="true"
							></i
							>{{ ranks.get(row.hash)!.name }}</template
						>
					</td>
					<td class="strong">{{ row.pb === null ? DASH : formatScore(row.pb) }}</td>
					<td
						:class="{ partial: !row.full }"
						:title="row.median !== null && !row.full ? `median of ${row.recent.length} ${row.recent.length === 1 ? 'run' : 'runs'}` : undefined"
					>
						<template v-if="row.median !== null"
							>{{ formatScore(row.median) }}<span v-if="row.gap !== null" class="gap"> · {{ formatGap(row.gap) }}</span></template
						>
						<span v-else class="dim">{{ DASH }}</span>
					</td>
					<td>{{ formatValue(row.runs) }}</td>
					<td class="dim" :title="timeFormat.format(new Date(row.lastPlayed))">{{ played(row.lastPlayed) }}</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<style scoped>
.scroll {
	overflow: auto;
	scrollbar-gutter: stable;
}

table {
	width: 100%;
	border-collapse: collapse;
}

/* Pinned while the body scrolls; the rule under it is a shadow because a sticky cell's border scrolls away. */
thead th {
	position: sticky;
	top: 0;
	z-index: 1;
	background: var(--color-surface);
	box-shadow: inset 0 -1px 0 var(--color-border);
	text-align: right;
	padding: 0;
	white-space: nowrap;
}

thead button {
	width: 100%;
	text-align: inherit;
	background: transparent;
	border: 0;
	padding: 6px 12px 7px;
	font: 400 9.5px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.13em;
	color: var(--color-text-faint);
	cursor: pointer;
}

thead button:hover,
thead button.active {
	color: var(--color-text);
}

thead button:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: -2px;
}

.arrow {
	display: inline-block;
	width: 1.2em;
	text-align: center;
}

.left,
thead .left {
	text-align: left;
}

tbody th,
td {
	padding: 6px 12px;
	border-bottom: 1px solid var(--color-rule-faint);
	font: 400 12.5px/1 var(--font-mono);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
	text-align: right;
	color: var(--color-text);
}

tbody th {
	font-weight: 400;
}

tbody tr {
	cursor: pointer;
}

tbody tr:hover {
	background: #141920;
}

tbody tr:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: -2px;
}

td.left {
	text-align: left;
}

.name {
	max-width: 44ch;
	overflow: hidden;
	text-overflow: ellipsis;
}

a {
	color: var(--color-text);
	text-decoration: none;
}

a:hover,
tbody tr:focus-visible a {
	color: var(--color-accent);
	text-decoration: underline;
}

.tag {
	margin-left: 8px;
	font-size: 10.5px;
	color: var(--color-text-faint);
}

.dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	margin-right: 7px;
	border-radius: 2px;
}

.strong {
	color: var(--color-text-strong);
}

.gap {
	color: var(--color-text-muted);
}

.partial {
	opacity: 0.55;
}

.dim {
	color: #a2a9b0;
}
</style>
