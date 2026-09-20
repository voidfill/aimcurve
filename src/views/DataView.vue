<script setup lang="ts">
/**
 * The Data page: connection state, import controls, and what the last pass did.
 *
 * Import state is shared and document-scoped, so a pass that commits while this
 * page is open updates it in place. Nothing here navigates on a commit: the
 * route is the user's, not the importer's.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import ConnectionStatus from '../components/ConnectionStatus.vue';
import ImportControls from '../components/ImportControls.vue';
import ImportReport from '../components/ImportReport.vue';
import { useDb } from '../composables/useDb';
import { useImport } from '../composables/useImport';
import { useSelection } from '../composables/useSelection';
import type { IngestReport } from '../lib/ingest/report';

const { ready, error: dbError, migration, retry: retryDb } = useDb();
const { state, connect, reconnect, importFiles, disconnect, retryScan } = useImport();
const { rememberedRunRoute } = useSelection();

const importDisabled = computed(() => !ready.value || dbError.value !== null);

/**
 * A folder pass that finds nothing still produces a report, all zeros. Letting
 * that overwrite the last report would quietly erase the failures the user still
 * has to act on, so a pass only replaces what is shown when it did work or found
 * something actionable — or when nothing has been shown yet.
 */
const shown = shallowRef<IngestReport | null>(null);

function actionable(report: IngestReport): boolean {
	return (
		report.runs > 0 ||
		report.aborts > 0 ||
		report.perfsMatched > 0 ||
		report.failures.length > 0 ||
		report.orphanPerfs.length > 0 ||
		report.ambiguousPerfs.length > 0 ||
		report.hashMismatches.length > 0
	);
}

watch(
	() => state.report,
	(report) => {
		if (report === null) return;
		if (shown.value === null || actionable(report)) shown.value = report;
	},
	{ immediate: true },
);

const lastImport = ref<string | null>(null);
const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
watch(
	() => state.lastImportAt,
	(value) => {
		lastImport.value = value === null ? null : timeFormat.format(new Date(value));
	},
	{ immediate: true },
);

function onImportFiles(files: File[]): void {
	void importFiles(files);
}
</script>

<template>
	<div class="data">
		<div class="head">
			<h1>Data</h1>
			<RouterLink :to="rememberedRunRoute">Return to Run</RouterLink>
		</div>

		<ConnectionStatus
			:connection="state.connection"
			:busy="state.busy"
			:message="state.message"
			:db-ready="ready"
			:db-error="dbError"
			:migration="migration"
			@retry-db="retryDb()"
		/>

		<ImportControls
			:connection="state.connection"
			:busy="state.busy"
			:disabled="importDisabled"
			@connect="connect()"
			@reconnect="reconnect()"
			@disconnect="disconnect()"
			@retry-scan="retryScan()"
			@import-files="onImportFiles"
		/>

		<p v-if="state.progress !== null" class="progress">
			Reading file {{ state.progress.done }} of {{ state.progress.total }}.
		</p>
		<p v-else-if="state.busy" class="progress">Reading files…</p>

		<p v-if="lastImport !== null" class="muted">Last import: {{ lastImport }}</p>
		<p v-else class="muted">No import has finished in this browser yet.</p>

		<ImportReport v-if="shown !== null" :report="shown" />
	</div>
</template>

<style scoped>
.data {
	display: flex;
	flex-direction: column;
	gap: var(--space-6);
	padding: var(--space-4);
	max-width: 70rem;
}

.head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--space-3);
}

h1 {
	font-size: 1.5rem;
}

.progress {
	font-size: 0.9375rem;
}

.muted {
	color: var(--color-text-muted);
	font-size: 0.9375rem;
}
</style>
