<script setup lang="ts">
/**
 * The rail of completed attempts.
 *
 * Explicitly *completed* attempts: resets and unattributed aborts are ingested
 * and are not shown here. Inspecting a reset is a later slice.
 *
 * The scenario filter has no control of its own here. It is set by links (a
 * scenario page's Play in Run) and by Enter on the row of the run being shown;
 * while it is on, a chip at the top names it and clears it.
 */
import type { RouteLocationRaw } from 'vue-router';
import AttemptRow from './AttemptRow.vue';
import type { Attempt } from '../lib/run/queries';
import type { LoadState } from '../composables/useAttempts';

defineProps<{
	attempts: Attempt[];
	selectedStem: string | null;
	state: LoadState;
	error: string | null;
	hasMore: boolean;
	loadingOlder: boolean;
	hasNewer: boolean;
	filtered: boolean;
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

		<p v-else-if="state === 'loading' && attempts.length === 0" class="muted">Loading attempts…</p>

		<p v-else-if="state === 'ready' && attempts.length === 0" class="muted">
			{{
				filtered
					? 'No completed attempts for this scenario.'
					: 'No completed attempts imported yet.'
			}}
		</p>

		<!--
			Keyed by `fileStem`, never by index: a refresh replaces the array, and
			an index key would make Vue destroy and rebuild every row, dropping
			keyboard focus in the middle of the list.
		-->
		<ul v-if="attempts.length > 0" class="list">
			<li v-for="attempt in attempts" :key="attempt.fileStem">
				<AttemptRow
					:attempt="attempt"
					:selected="attempt.fileStem === selectedStem"
					:to="linkTo(attempt.fileStem)"
					@filter="emit('filter', attempt.scenarioHash)"
				/>
			</li>
		</ul>

		<button v-if="hasMore" type="button" class="older" :disabled="loadingOlder" @click="emit('load-older')">
			{{ loadingOlder ? 'Loading…' : 'Load older' }}
		</button>
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
	gap: var(--space-1);
	overflow-y: auto;
	min-height: 0;
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

button:disabled {
	cursor: default;
	color: var(--color-text-muted);
}

.older {
	align-self: flex-start;
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
