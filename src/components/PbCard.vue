<script setup lang="ts">
/**
 * The PB card (S3 of the scenario page design): the best completed run, how
 * long it has stood, its rank, and a link into Run. A PB without a `.perf` is
 * shown all the same, with a note that it has no curve.
 */
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { formatValue, timeFormat } from '../lib/run/format';
import { formatResult, formatSince, type ResultKind } from '../lib/scenario/format';
import type { HistoryRun } from '../lib/scenario/queries';

const props = defineProps<{
	pb: HistoryRun | null;
	/** Completed runs after the PB. */
	runsSince: number;
	kind: ResultKind;
	rank: { name: string; color: string | null } | null;
	to: RouteLocationRaw | null;
}>();

const standing = computed(() => {
	if (props.pb === null) return null;
	const since = formatSince(props.pb.startedAt, new Date());
	const runs = `${formatValue(props.runsSince)} ${props.runsSince === 1 ? 'run' : 'runs'}`;
	return since === 'today' ? `set today · ${runs} since` : `standing for ${since} · ${runs} since`;
});
</script>

<template>
	<section class="panel" aria-labelledby="pb-heading">
		<header><h2 id="pb-heading">Personal best</h2></header>
		<div v-if="pb && pb.score !== null" class="body">
			<div class="result">
				<span class="label">{{ kind.kind === 'race' ? 'time' : 'score' }}</span>
				<span class="value">{{ formatResult(pb.score, kind) }}</span>
				<span v-if="rank" class="rank"><i v-if="rank.color" :style="{ background: rank.color }" aria-hidden="true"></i>{{ rank.name }}</span>
			</div>
			<p class="when">{{ timeFormat.format(new Date(pb.startedAt)) }}</p>
			<p class="when">{{ standing }}</p>
			<p v-if="!pb.hasPerf" class="note">No curve recorded: this run has no performance file, so Run shows its result only.</p>
			<RouterLink v-if="to" :to="to" class="open">Open in Run</RouterLink>
		</div>
		<p v-else class="body empty">No completed run of this scenario recorded a score.</p>
	</section>
</template>

<style scoped>
.panel {
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: 3px;
	min-width: 0;
}

header {
	padding: 8px 12px;
	border-bottom: 1px solid var(--color-border);
}

h2 {
	font: 500 11px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.15em;
	color: #c3c9cf;
}

.body {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 6px;
	padding: 12px;
}

.result {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 10px;
}

.label {
	font: 500 10px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.16em;
	color: var(--color-text-faint);
}

.value {
	font: 500 26px/1 var(--font-mono);
	font-variant-numeric: tabular-nums;
	color: var(--color-baseline);
}

.rank {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font: 500 12px/1 var(--font-mono);
	color: var(--color-text);
}

.rank i {
	width: 8px;
	height: 8px;
	border-radius: 2px;
}

.when {
	font: 400 11.5px/1.3 var(--font-mono);
	color: var(--color-text-muted);
}

.note {
	font: 400 11.5px/1.4 var(--font-mono);
	color: var(--color-text-faint);
	max-width: 44ch;
}

.open {
	margin-top: 4px;
	font: 500 12px/1 var(--font-mono);
	color: var(--color-accent);
}

.empty {
	color: var(--color-text-muted);
	font: 400 12px/1.4 var(--font-mono);
}
</style>
