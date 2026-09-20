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
	const run = to.query.run;
	const stem = Array.isArray(run) ? run[0] : run;
	document.title = typeof stem === 'string' && stem.length > 0 ? `${stem} — aimcurve` : 'Run — aimcurve';
});
</script>

<script setup lang="ts">
import { ref, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
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

watch(
	() => state.busy,
	(busy, was) => {
		if (busy || !was) return;
		const report = state.report;
		if (report === null) {
			announcement.value = state.message ?? 'Import finished.';
			return;
		}
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
	<p class="sr-only" aria-live="polite">{{ announcement }}</p>
</template>
