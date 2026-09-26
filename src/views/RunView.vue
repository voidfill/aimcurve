<script setup lang="ts">
/**
 * The Run page: one attempt's result beside a rail of completed attempts.
 *
 * Selection lives entirely in the route query, so Back, Forward, a reload and a
 * copied link all behave the same. This view creates `useAttempts`, whose
 * watchers stop when it unmounts; it never touches import state, so a trip to
 * Data and back cannot interrupt a running import.
 */
import { computed } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import AttemptRail from '../components/AttemptRail.vue';
import EmptyState from '../components/EmptyState.vue';
import RunDetail from '../components/RunDetail.vue';
import SelectionPill from '../components/SelectionPill.vue';
import { useAttempts } from '../composables/useAttempts';
import { useDb } from '../composables/useDb';
import { useHasRuns } from '../composables/useHasRuns';
import { useImport } from '../composables/useImport';
import { useSelection } from '../composables/useSelection';
import { timeFormat } from '../lib/run/format';

const { ready, error: dbError } = useDb();
const { state } = useImport();
const { mode, fileStem, scenarioHash, linkTo, resumeLatest, setFilter } = useSelection();
const {
	scenarios,
	scenariosError,
	filterState,
	items,
	railState,
	railError,
	hasMore,
	loadingOlder,
	loadOlder,
	selected,
	selectionState,
	selectionError,
	selectionOutsideFilter,
	selectionOffPage,
	hasNewer,
	retry,
} = useAttempts();

/** The inspected run's start, for the application bar's pill. */
const inspectedAt = computed(() =>
	mode.value === 'inspect' && selected.value ? timeFormat.format(new Date(selected.value.startedAt)) : null,
);

/**
 * The rail filter's chip label: the scenario's name, or its short hash while
 * the names load, when they cannot be listed, or when this browser has no
 * such scenario.
 */
const filterLabel = computed(() => {
	const hash = scenarioHash.value;
	if (hash === null) return null;
	const name = scenarios.value.find((option) => option.hash === hash)?.name;
	if (name) return name;
	return filterState.value === 'unknown' ? `Unknown scenario · ${hash.slice(0, 8)}` : hash.slice(0, 8);
});

/** The rail marks the requested row at once, not after the attempt has loaded. */
const railStem = computed(() => (mode.value === 'inspect' ? fileStem.value : (selected.value?.fileStem ?? null)));

/** Below this the rail stops being a column and becomes an ordinary section. */
const narrow = useMediaQuery('(max-width: 799px)');

/** A working database with no completed run: the page is only the empty state. */
const hasRuns = useHasRuns();
const onboarding = computed(() => dbError.value === null && ready.value && hasRuns.value === false);
</script>

<template>
	<Teleport defer to="#app-bar-status">
		<SelectionPill
			v-if="dbError === null && ready && !onboarding"
			:mode="mode"
			:inspected-at="inspectedAt"
			:has-newer="hasNewer"
			@resume-latest="resumeLatest()"
		/>
	</Teleport>
	<EmptyState v-if="onboarding" />
	<p v-else-if="dbError === null && (!ready || hasRuns === null)" class="muted starting pending">
		{{ ready ? 'Loading attempts…' : 'Starting the local database…' }}
	</p>
	<div v-else class="run" :class="{ narrow, fill: !narrow }">
		<div class="result">
			<section v-if="dbError !== null" class="notice danger" role="alert">
				<h1>Attempts are unavailable</h1>
				<p>The local database could not be opened, so no attempt can be read.</p>
				<p>{{ dbError.message }}</p>
				<RouterLink :to="{ name: 'data' }">Open Data to retry</RouterLink>
			</section>

			<template v-else>
				<!-- A switch keeps the previous attempt on screen until the next resolves. -->
				<p v-if="selectionState === 'loading' && selected === null" class="muted pending">Loading attempt…</p>

				<section v-else-if="selectionState === 'error'" class="notice danger" role="alert">
					<h1>This attempt could not be read</h1>
					<p>{{ selectionError }}</p>
					<button type="button" @click="retry()">Try again</button>
				</section>

				<section v-else-if="selectionState === 'missing'" class="notice" role="alert">
					<h1>That run is not in this browser</h1>
					<p>
						The link points at <code>{{ fileStem }}</code
						>, which is not in this browser's database. It may have been imported in a different
						browser or profile, or removed by a database reset. No other run has been shown in its
						place.
					</p>
					<div class="actions">
						<button type="button" @click="resumeLatest()">Show the latest attempt instead</button>
						<RouterLink :to="{ name: 'data' }">Import the file</RouterLink>
					</div>
				</section>

				<section v-else-if="selectionState === 'empty'" class="notice">
					<h1>No completed attempts here</h1>
					<p v-if="filterState === 'unknown'">
						The scenario in this link is not one this browser has attempts for. It may belong to a
						different browser, or to data a database reset removed.
					</p>
					<p v-else>This scenario has no completed attempts in this browser yet.</p>
					<div class="actions">
						<button type="button" @click="setFilter(null)">Show all scenarios</button>
						<RouterLink :to="{ name: 'data' }">Import more files</RouterLink>
					</div>
				</section>

				<template v-else-if="selected !== null">
					<RunDetail :attempt="selected" :fill="!narrow" />

					<p v-if="selectionOutsideFilter" class="note">
						This attempt is not in the scenario the filter selects, so it is not in the rail. The
						filter is still applied to the list.
						<button type="button" @click="setFilter(null)">Show all scenarios</button>
					</p>
					<p v-else-if="selectionOffPage" class="note">
						This attempt is older than the part of the list loaded so far, so it has no row in the
						rail yet.
					</p>
				</template>
			</template>
		</div>

		<aside class="rail-column">
			<AttemptRail
				:attempts="items"
				:selected-stem="railStem"
				:state="railState"
				:error="railError"
				:has-more="hasMore"
				:loading-older="loadingOlder"
				:has-newer="hasNewer"
				:filtered="scenarioHash !== null"
				:filter-label="filterLabel"
				:filter-error="scenariosError"
				:link-to="linkTo"
				@filter="setFilter"
				@load-older="loadOlder()"
				@resume-latest="resumeLatest()"
				@retry="retry()"
			/>
			<p v-if="state.busy" class="muted">Importing…</p>
		</aside>
	</div>
</template>

<style scoped>
.run {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 340px;
	gap: 18px;
	align-items: start;
	padding: 12px 18px;
}

/*
	Below 800px the rail is no longer a column with its own scroll; it follows
	the result as an ordinary section, so the result stays the priority.
*/
.run.narrow {
	grid-template-columns: minmax(0, 1fr);
}

/*
	Wider, the view fills the page and never scrolls it: the rail and the result
	each take the full height. The result fits itself to that height (see
	RunDetail) and scrolls on its own only when even its floors do not fit.
*/
.run.fill {
	grid-template-rows: minmax(0, 1fr);
	align-items: stretch;
}

.run.fill .result {
	min-height: 0;
	overflow-y: auto;
	scrollbar-gutter: stable;
}

.result {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
}

.rail-column {
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
	min-width: 0;
}

/* The rail scrolls its own list, independently of the result column. */
.run.fill .rail-column {
	min-height: 0;
	overflow: hidden;
}

.notice {
	display: flex;
	flex-direction: column;
	gap: var(--space-3);
	align-items: flex-start;
	padding: var(--space-4);
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: var(--color-surface);
	max-width: 62ch;
}

.notice.danger {
	border-color: var(--color-danger);
}

.notice h1 {
	font-size: 1.25rem;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-3);
}

.note {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2);
	padding: var(--space-2) var(--space-3);
	border: 1px solid var(--color-border);
	border-radius: 6px;
	color: var(--color-text-muted);
	font-size: 0.875rem;
	max-width: 70ch;
}

.muted {
	color: var(--color-text-muted);
}

.starting {
	padding: 12px 18px 24px;
}

button {
	background: transparent;
	border: 1px solid var(--color-border);
	border-radius: 6px;
	padding: var(--space-1) var(--space-3);
	cursor: pointer;
}

button:hover {
	border-color: var(--color-accent);
}
</style>
