<script setup lang="ts">
/**
 * The rail of completed attempts, grouped by session.
 *
 * Explicitly *completed* attempts: resets and unattributed aborts are ingested
 * and are not shown here. Inspecting a reset is a later slice.
 *
 * The scenario filter has no control of its own here. It is set by links (a
 * scenario page's Play in Run) and by Enter on the row of the run being shown;
 * while it is on, a chip at the top names it and clears it. Filtered, the
 * session headers compare each session with the scenario's previous one.
 *
 * Older pages load as the end of the list scrolls into view. The sentinel is
 * observed against the viewport, which also clips by the list's own scroll
 * box, so the same observer works whether the list or the page scrolls. It is
 * keyed by the row count, so each settled page is judged by a fresh report
 * taken after its rows were laid out, never by the one from before them.
 */
import { computed, ref, shallowRef, watch, watchEffect } from 'vue';
import { useIntersectionObserver, useIntervalFn, useNow } from '@vueuse/core';
import type { RouteLocationRaw } from 'vue-router';
import AttemptRow from './AttemptRow.vue';
import SessionHeader from './SessionHeader.vue';
import type { RailAttempt, SessionSummary } from '../lib/run/queries';
import { groupBySession, rankLookup } from '../lib/run/rail';
import type { LoadState } from '../composables/useAttempts';
import { loadedSnapshot, loadSnapshot, storedPicks, usePicks } from '../composables/useBenchmarkRank';

const props = defineProps<{
	attempts: RailAttempt[];
	sessions: Map<number, SessionSummary>;
	selectedStem: string | null;
	state: LoadState;
	error: string | null;
	hasMore: boolean;
	loadingOlder: boolean;
	hasNewer: boolean;
	filtered: boolean;
	/** The filtered scenario's id, once known; null without a filter. */
	scenarioId: number | null;
	/** The filtered scenario's name, or null without a filter. */
	filterLabel: string | null;
	/** Why scenario names could not be listed, if they could not. */
	filterError: string | null;
	linkTo: (stem: string) => RouteLocationRaw;
}>();

const emit = defineEmits<{
	(event: 'filter', hash: string | null): void;
	(event: 'load-older'): void;
	(event: 'resume-latest'): void;
	(event: 'retry'): void;
}>();

/* Ranks: the run header's benchmark pick, per scenario. Rows are plain until the snapshot loads. */
const snapshot = shallowRef(loadedSnapshot());
if (snapshot.value === null)
	loadSnapshot().then(
		(loaded) => (snapshot.value = loaded),
		(err: unknown) => console.error('The benchmark snapshot could not be loaded', err),
	);
const picks = usePicks();
const ranks = computed(() => {
	const rankOf = rankLookup(snapshot.value, storedPicks(picks.value));
	return new Map(props.attempts.map((a) => [a.fileStem, rankOf(a.scenarioName, a.score)]));
});

const groups = computed(() => groupBySession(props.attempts));

/** For the headers' Today and Yesterday, which must turn over at midnight on an open page. */
const now = useNow({ scheduler: (tick) => useIntervalFn(tick, 60_000) });

/* Loading older pages as the list's end comes into view. */
const sentinel = ref<HTMLElement | null>(null);
const atEnd = ref(false);
useIntersectionObserver(sentinel, ([entry]) => {
	atEnd.value = entry?.isIntersecting ?? false;
});
// A sentinel that is gone, or replaced, has not been seen yet.
watch(sentinel, () => {
	atEnd.value = false;
});

/** A failed page stops the loop; its retry is the button below, and a retry in flight shows as loading. */
const olderFailed = computed(() => props.state === 'ready' && props.error !== null && !props.loadingOlder);

watchEffect(() => {
	if (atEnd.value && props.hasMore && !props.loadingOlder && props.state === 'ready' && !olderFailed.value) {
		// Spent: only the next page's sentinel can ask again.
		atEnd.value = false;
		emit('load-older');
	}
});
</script>

<template>
	<section class="rail" aria-labelledby="rail-heading">
		<h2 id="rail-heading">Completed attempts</h2>

		<p v-if="filterLabel !== null" class="chip">
			<span class="chip-name" :title="filterLabel">{{ filterLabel }}</span>
			<button type="button" @click="emit('filter', null)">Show all runs</button>
		</p>
		<p v-if="filterLabel !== null && filterError !== null" class="error">
			Scenario names could not be listed. {{ filterError }}
		</p>

		<p v-if="hasNewer" class="newer">
			<span>A newer completed attempt has been imported.</span>
			<button type="button" @click="emit('resume-latest')">Resume latest</button>
		</p>

		<p v-if="state === 'error'" class="error">
			<span>The attempt list could not be read. {{ error }}</span>
			<button type="button" @click="emit('retry')">Try again</button>
		</p>

		<p v-else-if="state === 'loading' && attempts.length === 0" class="muted pending">Loading attempts…</p>

		<p v-else-if="state === 'ready' && attempts.length === 0" class="muted">
			{{
				filtered
					? 'No completed attempts for this scenario.'
					: 'No completed attempts imported yet.'
			}}
		</p>

		<!--
			Rows are keyed by `fileStem`, never by index: a refresh replaces the
			array, and an index key would make Vue destroy and rebuild every row,
			dropping keyboard focus in the middle of the list.
		-->
		<ul v-if="attempts.length > 0" class="list">
			<li v-for="group in groups" :key="group.sessionId" class="group">
				<SessionHeader
					class="header"
					:summary="sessions.get(group.sessionId)"
					:newest="group.rows[0]!.startedAt"
					:oldest="group.rows[group.rows.length - 1]!.startedAt"
					:filtered="filtered"
					:scenario-id="scenarioId"
					:now="now"
				/>
				<ul class="rows">
					<li v-for="attempt in group.rows" :key="attempt.fileStem">
						<AttemptRow
							:attempt="attempt"
							:selected="attempt.fileStem === selectedStem"
							:to="linkTo(attempt.fileStem)"
							:rank="ranks.get(attempt.fileStem) ?? null"
							@filter="emit('filter', attempt.scenarioHash)"
						/>
					</li>
				</ul>
			</li>
			<li v-if="hasMore" :key="`end-${attempts.length}`" ref="sentinel" class="end">
				<p v-if="olderFailed" class="error">
					<span>Older attempts could not be read. {{ error }}</span>
					<button type="button" @click="emit('load-older')">Try again</button>
				</p>
				<span v-else class="muted pending">Loading older attempts…</span>
			</li>
		</ul>
	</section>
</template>

<style scoped>
.rail {
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
	min-height: 0;
}

h2 {
	font-size: 0.875rem;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--color-text-muted);
}

.list {
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: var(--space-3);
	overflow-y: auto;
	/* Rows keep their width whether or not the list overflows. */
	scrollbar-gutter: stable;
	min-height: 0;
}

/* Each session is a card, so where one ends and the next begins is plain. No overflow clip: it would unstick the header. */
.group {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: var(--color-surface);
}

/* Each header stays in view while its session scrolls past. */
.header {
	position: sticky;
	top: 0;
	z-index: 1;
}

.rows {
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 4px;
}

.end {
	padding: var(--space-2) var(--space-3);
}

/* Below RunView's 800px breakpoint the page scrolls, not the list, so no gutter is kept for it. */
@media (max-width: 799px) {
	.list {
		overflow-y: visible;
		scrollbar-gutter: auto;
	}
}

.newer,
.error {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2);
	padding: var(--space-2);
	border: 1px solid var(--color-border);
	border-radius: 6px;
	background: var(--color-surface);
	font-size: 0.875rem;
}

.error {
	border-color: var(--color-danger);
}

.muted {
	color: var(--color-text-muted);
	font-size: 0.875rem;
}

button {
	background: transparent;
	border: 1px solid var(--color-border);
	border-radius: 6px;
	padding: var(--space-1) var(--space-3);
	cursor: pointer;
}

button:hover:not(:disabled) {
	border-color: var(--color-accent);
}

.chip {
	display: flex;
	align-items: center;
	gap: var(--space-2);
	padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
	border: 1px solid var(--color-accent);
	border-radius: 6px;
	background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	font-size: 0.8125rem;
}

.chip-name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.chip button {
	flex: none;
	font-size: 0.75rem;
}
</style>
