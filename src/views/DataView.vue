<script setup lang="ts">
/**
 * The Data page: what the import is doing, how to start one, and what the last
 * one did.
 *
 * Import state is shared and document-scoped, so a pass that commits while this
 * page is open updates it in place. Nothing here navigates on a commit: the
 * route is the user's, not the importer's.
 */
import { computed, ref, watch } from 'vue';
import ConnectionStatus from '../components/ConnectionStatus.vue';
import ImportControls from '../components/ImportControls.vue';
import ImportReport from '../components/ImportReport.vue';
import { useDb } from '../composables/useDb';
import { useImport } from '../composables/useImport';
import { useSelection } from '../composables/useSelection';

const { ready, error: dbError, retry: retryDb } = useDb();
const { state, connect, reconnect, importFiles, disconnect, retryScan } = useImport();
const { rememberedRunRoute } = useSelection();

const importDisabled = computed(() => !ready.value || dbError.value !== null);

// `state.report` and `state.lastImportAt` already describe the last pass that
// did work — a no-op background poll leaves both alone — so this page renders
// them directly. Guarding here instead would only hold while the page stayed
// mounted, and a trip to Run and back would lose the guard with it.
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
			:progress="state.progress"
			:message="state.message"
			:db-ready="ready"
			:db-error="dbError"
			@retry-db="retryDb()"
			@retry-scan="retryScan()"
		/>

		<ImportControls
			:connection="state.connection"
			:disabled="importDisabled"
			@connect="connect()"
			@reconnect="reconnect()"
			@disconnect="disconnect()"
			@import-files="onImportFiles"
		/>

		<ImportReport v-if="state.report !== null" :report="state.report" :at="lastImport" />
		<p v-else class="muted">Nothing has been imported in this browser yet.</p>
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

.muted {
	color: var(--color-text-muted);
	font-size: 0.9375rem;
}
</style>
