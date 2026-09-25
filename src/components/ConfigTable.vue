<script setup lang="ts">
/**
 * The configs panel (S3, S4 of the scenario page design): one row per config
 * group, most recently used first. Hovering or focusing a row highlights its
 * runs in the chart; clicking or Enter pins that highlight.
 *
 * It describes what happened under each config. It does not isolate the
 * config's effect: later configs benefit from practice, which the caption says.
 */
import { computed } from 'vue';
import { formatValue, timeFormat } from '../lib/run/format';
import { type ConfigGroup, NEUTRAL } from '../lib/scenario/config';
import { formatFov, formatResult, formatSens, type ResultKind } from '../lib/scenario/format';

const props = defineProps<{
	groups: readonly ConfigGroup[];
	kind: ResultKind;
	active: number | null;
	pinned: number | null;
}>();

const emit = defineEmits<{
	(event: 'hover', index: number | null): void;
	(event: 'toggle', index: number): void;
}>();

const DASH = '—';

const rows = computed(() =>
	[...props.groups]
		.sort((a, b) => (a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : b.index - a.index))
		.map((g) => ({
			i: g.index - 1,
			label: g.label,
			color: g.color ?? NEUTRAL,
			current: g.current,
			sens: formatSens(g.config),
			dpi: formatValue(g.config.dpi),
			fov: formatFov(g.config),
			runs: formatValue(g.runs),
			best: g.best === null ? DASH : formatResult(g.best, props.kind),
			median: g.median === null ? DASH : formatResult(g.median, props.kind),
			last: timeFormat.format(new Date(g.lastUsed)),
		})),
);

function onKey(event: KeyboardEvent, i: number): void {
	if (event.key === 'Enter' || event.key === ' ') {
		event.preventDefault();
		emit('toggle', i);
	}
}
</script>

<template>
	<section class="panel" aria-labelledby="configs-heading">
		<header>
			<h2 id="configs-heading">Configs</h2>
			<span class="sub">sens, DPI and FOV · what happened under each, not what each caused: later configs have more practice behind them</span>
		</header>
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th scope="col" class="name">config</th>
						<th scope="col" class="left">sens</th>
						<th scope="col">dpi</th>
						<th scope="col" class="left">fov</th>
						<th scope="col">runs</th>
						<th scope="col">best</th>
						<th scope="col">median</th>
						<th scope="col">last used</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="row in rows"
						:key="row.label"
						tabindex="0"
						:class="{ on: active === row.i || pinned === row.i }"
						:aria-pressed="pinned === row.i"
						@mouseenter="emit('hover', row.i)"
						@mouseleave="emit('hover', null)"
						@focus="emit('hover', row.i)"
						@blur="emit('hover', null)"
						@click="emit('toggle', row.i)"
						@keydown="onKey($event, row.i)"
					>
						<th scope="row" class="name">
							<i class="swatch" :style="{ background: row.color }" aria-hidden="true"></i>{{ row.label }}
							<span v-if="row.current" class="current">current</span>
						</th>
						<td class="left strong">{{ row.sens }}</td>
						<td class="dim">{{ row.dpi }}</td>
						<td class="left dim">{{ row.fov }}</td>
						<td class="dim">{{ row.runs }}</td>
						<td class="strong">{{ row.best }}</td>
						<td>{{ row.median }}</td>
						<td class="dim">{{ row.last }}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>
</template>

<style scoped>
.panel {
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: 3px;
	display: flex;
	flex-direction: column;
	min-width: 0;
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

.sub {
	font: 400 11px/1.3 var(--font-mono);
	color: var(--color-text-faint);
}

.scroll {
	overflow: auto;
}

table {
	width: 100%;
	border-collapse: collapse;
}

thead th {
	text-align: right;
	font: 400 9.5px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.13em;
	color: var(--color-text-faint);
	padding: 6px 12px 7px;
	white-space: nowrap;
}

th.name,
.left {
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

td {
	text-align: right;
	color: var(--color-text);
}

td.left {
	text-align: left;
}

.swatch {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	margin-right: 8px;
}

.current {
	margin-left: 8px;
	padding: 2px 5px;
	border: 1px solid var(--color-accent);
	border-radius: 3px;
	font-size: 9.5px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-accent);
}

.dim {
	color: #a2a9b0;
}

.strong {
	color: var(--color-text-strong);
}
</style>
