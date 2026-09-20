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
import RunSummary from '../components/RunSummary.vue';
import ScenarioFilter from '../components/ScenarioFilter.vue';
import { useAttempts } from '../composables/useAttempts';
import { useDb } from '../composables/useDb';
import { useImport } from '../composables/useImport';
import { useSelection } from '../composables/useSelection';

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

/** Below this the rail stops being a column and becomes an ordinary section. */
const narrow = useMediaQuery('(max-width: 799px)');

/**
 * The first-use state: a working database with nothing in it and no filter
 * hiding anything.
 */
const onboarding = computed(
	() =>
		dbError.value === null &&
		ready.value &&
		railState.value === 'ready' &&
		items.value.length === 0 &&
		filterState.value === 'all' &&
		selected.value === null,
);
</script>

<template>
	<div class="run" :class="{ narrow }">
		<div class="result">
			<ScenarioFilter
				:options="scenarios"
				:selected="scenarioHash"
				:state="filterState"
				:error="scenariosError"
				@change="setFilter"
			/>

			<section v-if="dbError !== null" class="notice danger" role="alert">
				<h1>Attempts are unavailable</h1>
				<p>The local database could not be opened, so no attempt can be read.</p>
				<p>{{ dbError.message }}</p>
				<RouterLink :to="{ name: 'data' }">Open Data to retry</RouterLink>
			</section>

			<p v-else-if="!ready" class="muted">Starting the local database…</p>

			<section v-else-if="onboarding" class="notice">
				<h1>Nothing imported yet</h1>
				<p>
					aimcurve reads the stats files Kovaak's writes on this computer. The files are parsed and
					stored in this browser: nothing is uploaded, nothing is installed, no account exists, nothing
					is shared publicly, and nothing syncs to your other devices.
				</p>
				<p>
					Connect your <code>FPSAimTrainer/stats</code> folder — or import a one-time snapshot of it if
					your browser cannot connect to folders.
				</p>
				<RouterLink :to="{ name: 'data' }">Import your stats</RouterLink>
			</section>

			<template v-else>
				<p v-if="selectionState === 'loading'" class="muted">Loading attempt…</p>

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
					<RunSummary :attempt="selected" />

					<p v-if="selectionOutsideFilter" class="note">
						This attempt is not in the scenario the filter selects, so it is not in the rail. The
						filter is still applied to the list.
						<button type="button" @click="setFilter(null)">Show all scenarios</button>
					</p>
					<p v-else-if="selectionOffPage" class="note">
						This attempt is older than the part of the list loaded so far, so it has no row in the
						rail yet.
					</p>
					<p v-if="mode === 'inspect'" class="note">
						Inspecting an attempt. New imports keep arriving, but the selection stays where it is.
						<button type="button" @click="resumeLatest()">Resume latest</button>
					</p>
				</template>
			</template>
		</div>

		<aside class="rail-column">
			<AttemptRail
				:attempts="items"
				:selected-stem="selected?.fileStem ?? null"
				:state="railState"
				:error="railError"
				:has-more="hasMore"
				:loading-older="loadingOlder"
				:has-newer="hasNewer"
				:filtered="scenarioHash !== null"
				:link-to="linkTo"
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
	grid-template-columns: minmax(0, 1fr) 320px;
	gap: var(--space-6);
	align-items: start;
	padding: var(--space-4);
}

/*
	Below 800px the rail is no longer a column with its own scroll; it follows
	the result as an ordinary section, so the result stays the priority.
*/
.run.narrow {
	grid-template-columns: minmax(0, 1fr);
}

.result {
	display: flex;
	flex-direction: column;
	gap: var(--space-4);
	min-width: 0;
}

.rail-column {
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
	min-width: 0;
	/* The rail scrolls independently of the result column. */
	max-height: calc(100vh - 8rem);
	overflow: hidden;
}

.run.narrow .rail-column {
	max-height: none;
	overflow: visible;
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
