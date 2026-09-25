<script setup lang="ts">
/**
 * Recent runs (S3 of the scenario page design): the last completed runs,
 * newest first, 20 at a time. Each row opens Run inspecting that run. Δ is
 * against the PB before that run, so a new PB shows how far it moved the PB.
 */
import { computed, ref, watch } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { timeFormat } from '../lib/run/format';
import { type ConfigGroup, NEUTRAL } from '../lib/scenario/config';
import { formatDelta, formatResult, type ResultKind } from '../lib/scenario/format';
import type { HistoryRun } from '../lib/scenario/queries';

const props = defineProps<{
	/** Oldest first, as loaded. */
	runs: readonly HistoryRun[];
	groupOf: readonly number[];
	groups: readonly ConfigGroup[];
	kind: ResultKind;
	rankOf: (score: number) => { name: string; color: string | null } | null;
	linkTo: (run: HistoryRun) => RouteLocationRaw;
}>();

const PAGE = 20;
const shown = ref(PAGE);
watch(
	() => props.runs[0]?.fileStem,
	() => (shown.value = PAGE),
);

const DASH = '—';

const rows = computed(() => {
	const out = [];
	for (let i = props.runs.length - 1; i >= 0 && out.length < shown.value; i--) {
		const run = props.runs[i]!;
		const group = props.groups[props.groupOf[i]!]!;
		const diff = run.score !== null && run.pbBefore !== null ? run.score - run.pbBefore : null;
		const rank = run.score === null ? null : props.rankOf(run.score);
		out.push({
			run,
			time: timeFormat.format(new Date(run.startedAt)),
			result: run.score === null ? 'No score' : formatResult(run.score, props.kind),
			delta: diff === null ? DASH : formatDelta(diff, props.kind),
			tone: diff === null || diff === 0 ? 'dim' : diff > 0 ? 'ahead' : 'behind',
			pb: diff !== null && diff > 0,
			rank,
			group: { label: group.label, color: group.color ?? NEUTRAL },
		});
	}
	return out;
});
</script>

<template>
	<section class="panel" aria-labelledby="recent-heading">
		<header>
			<h2 id="recent-heading">Recent runs</h2>
			<span class="sub">Δ is against the PB before each run</span>
		</header>
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th scope="col" class="left">played</th>
						<th scope="col">{{ kind.kind === 'race' ? 'time' : 'score' }}</th>
						<th scope="col">Δ PB before</th>
						<th scope="col" class="left">rank</th>
						<th scope="col" class="left">config</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in rows" :key="row.run.fileStem">
						<th scope="row" class="left">
							<RouterLink :to="linkTo(row.run)">{{ row.time }}</RouterLink>
						</th>
						<td class="strong">{{ row.result }}<span v-if="row.pb" class="new-pb">PB</span></td>
						<td :class="row.tone">{{ row.delta }}</td>
						<td class="left">
							<template v-if="row.rank"
								><i v-if="row.rank.color" class="dot" :style="{ background: row.rank.color }" aria-hidden="true"></i
								>{{ row.rank.name }}</template
							>
							<span v-else class="dim">{{ DASH }}</span>
						</td>
						<td class="left dim">
							<i class="dot round" :style="{ background: row.group.color }" aria-hidden="true"></i>{{ row.group.label }}
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<button v-if="runs.length > shown" type="button" class="more" @click="shown += PAGE">
			Show {{ Math.min(PAGE, runs.length - shown) }} more
		</button>
	</section>
</template>

<style scoped>
.panel {
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: 3px;
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
	font: 400 11px/1.2 var(--font-mono);
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

.left {
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
	text-align: left;
}

tbody tr:hover {
	background: #141920;
}

td.left {
	text-align: left;
}

a {
	color: var(--color-text);
	text-decoration: none;
}

a:hover,
a:focus-visible {
	color: var(--color-accent);
	text-decoration: underline;
}

.new-pb {
	margin-left: 8px;
	padding: 1px 4px;
	border: 1px solid var(--color-baseline);
	border-radius: 3px;
	font-size: 9.5px;
	color: var(--color-baseline);
}

.dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	margin-right: 7px;
	border-radius: 2px;
}

.dot.round {
	border-radius: 50%;
}

.strong {
	color: var(--color-text-strong);
}

.dim {
	color: #a2a9b0;
}

.ahead {
	color: var(--color-ahead);
}

.behind {
	color: var(--color-behind);
}

.more {
	margin: 8px 12px;
	background: transparent;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	padding: var(--space-1) var(--space-3);
	font: 400 12px/1.4 var(--font-mono);
	cursor: pointer;
}

.more:hover {
	border-color: var(--color-accent);
}
</style>
