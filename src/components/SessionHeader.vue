<script setup lang="ts">
/**
 * A session's header in the attempt rail: when it was, how many runs, and
 * whether it went better than usual.
 *
 * Unfiltered, the change is each scenario's session median against the median
 * of its last runs before the session, averaged over scenarios. Filtered to one
 * scenario, it is the session's best against the previous session's best.
 * Until the totals load, or if they cannot, the header falls back to the times
 * of the rows it heads.
 */
import { computed } from 'vue';
import { formatScore } from '../lib/run/format';
import { BASELINE_RUNS, type SessionSummary } from '../lib/run/queries';
import { formatChange, formatDelta, sessionChange } from '../lib/run/rail';

const props = defineProps<{
	summary: SessionSummary | undefined;
	/** The loaded rows' start times, newest first, for the fallback. */
	newest: string;
	oldest: string;
	filtered: boolean;
}>();

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

function dayLabel(date: Date): string {
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	if (date.toDateString() === today.toDateString()) return 'Today';
	if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
	return dayFormat.format(date);
}

const when = computed(() => {
	const start = new Date(props.summary?.startedAt ?? props.oldest);
	const end = new Date(props.summary?.endedAt ?? props.newest);
	const from = timeFormat.format(start);
	const to = timeFormat.format(end);
	return `${dayLabel(start)} · ${from === to ? from : `${from}–${to}`}`;
});

const runs = computed(() => {
	const n = props.summary?.runs;
	return n === undefined ? null : `${n} ${n === 1 ? 'run' : 'runs'}`;
});

type Line = { value: string | null; tone: 'ahead' | 'behind' | 'even'; text: string; title: string };

function tone(x: number): Line['tone'] {
	return x > 0 ? 'ahead' : x < 0 ? 'behind' : 'even';
}

const line = computed<Line | null>(() => {
	const s = props.summary;
	if (s === undefined || s.scenarios.length === 0) return null;
	if (props.filtered) {
		const scenario = s.scenarios[0]!;
		const best = `best ${formatScore(scenario.best)}`;
		if (scenario.prevBest === null)
			return { value: null, tone: 'even', text: `${best} · first session`, title: 'No earlier session played this scenario' };
		const d = scenario.best - scenario.prevBest;
		return {
			value: formatDelta(d),
			tone: tone(d),
			text: `${best} · vs last session`,
			title: `This session's best against the best of the last session that played this scenario (${formatScore(scenario.prevBest)})`,
		};
	}
	const change = sessionChange(s.scenarios);
	if (change === null)
		return { value: null, tone: 'even', text: 'first session on these scenarios', title: 'None of these scenarios was played before this session' };
	return {
		value: formatChange(change),
		tone: tone(change),
		text: 'vs recent form',
		title: `Each scenario's median this session against the median of its last ${BASELINE_RUNS} runs before it, averaged over scenarios`,
	};
});
</script>

<template>
	<div class="session">
		<div class="top">
			<span>{{ when }}</span>
			<span v-if="runs" class="muted">{{ runs }}</span>
		</div>
		<div v-if="line" class="line" :title="line.title">
			<span v-if="line.value" class="value" :class="line.tone">{{ line.value }}</span>
			<span class="muted">{{ line.text }}</span>
		</div>
	</div>
</template>

<style scoped>
.session {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: var(--space-2) var(--space-3);
	border-bottom: 1px solid var(--color-border);
	background: var(--color-bg);
	font-size: 0.8125rem;
}

.top {
	display: flex;
	justify-content: space-between;
	gap: var(--space-2);
	color: var(--color-text);
}

.line {
	display: flex;
	align-items: baseline;
	gap: 0.4em;
	font-size: 0.75rem;
}

.value {
	font-family: var(--font-mono);
	font-size: 0.875rem;
}

.muted {
	color: var(--color-text-muted);
}

.ahead {
	color: var(--color-ahead);
}

.behind {
	color: var(--color-behind);
}

.even {
	color: var(--color-text-muted);
}
</style>
