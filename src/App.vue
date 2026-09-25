<script lang="ts">
/**
 * Route titles. Registered at module scope so exactly one hook exists for the
 * document's lifetime, whatever happens to the component.
 */
import { router } from './router';

router.afterEach((to) => {
	if (to.name === 'data') {
		document.title = 'Data — aimcurve';
		return;
	}
	// The Scenario view names the tab after its scenario once it has loaded.
	if (to.name === 'scenario') {
		document.title = 'Scenario — aimcurve';
		return;
	}
	const run = to.query.run;
	const stem = Array.isArray(run) ? run[0] : run;
	document.title = typeof stem === 'string' && stem.length > 0 ? `${stem} — aimcurve` : 'Run — aimcurve';
});
</script>

<script setup lang="ts">
import { ref, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
import DropImport from './components/DropImport.vue';
import { useDb } from './composables/useDb';
import { useImport } from './composables/useImport';

const { error: dbError } = useDb();
const { state } = useImport();

/**
 * One polite live region, for things worth interrupting nothing to say: an
 * import that finished, an import that failed, a database that would not open.
 * Progress ticks are deliberately not announced — a screen reader reading every
 * file of a scan is noise, and the count is on the page for anyone who wants it.
 */
const announcement = ref('');

/**
 * The timestamp of the pass this region last spoke about. `lastImportAt` only
 * advances on a pass that actually did work, so an unchanged one means the pass
 * that just settled imported nothing — and announcing the previous pass's counts
 * again would be a claim about an import that did not happen.
 */
let announcedAt: string | null = null;

watch(
	() => state.busy,
	(busy, was) => {
		if (busy || !was) return;
		const report = state.report;
		if (report === null) {
			announcement.value = state.message ?? 'Import finished.';
			return;
		}
		const at = state.lastImportAt;
		if (at === null || at === announcedAt) return;
		announcedAt = at;
		const added = `Import finished. ${report.runs} ${report.runs === 1 ? 'attempt' : 'attempts'} added.`;
		announcement.value =
			report.failures.length > 0
				? `${added} ${report.failures.length} ${report.failures.length === 1 ? 'file' : 'files'} could not be read.`
				: added;
	},
);

watch(
	() => state.connection,
	(connection) => {
		if (connection !== 'error' && connection !== 'reconnect') return;
		announcement.value = state.message ?? 'The import could not continue.';
	},
);

watch(dbError, (error) => {
	if (error === null) return;
	announcement.value = 'The local database could not be opened. Importing is unavailable.';
});
</script>

<template>
	<AppHeader />
	<main>
		<RouterView />
	</main>
	<DropImport />
	<p class="sr-only" aria-live="polite">{{ announcement }}</p>
</template>
