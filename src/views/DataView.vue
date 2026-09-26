<script setup lang="ts">
/**
 * The Data page: what the import is doing, how to start one, and what the last
 * one did.
 *
 * Import state is shared and document-scoped, so a pass that commits while this
 * page is open updates it in place. Nothing here navigates on a commit: the
 * route is the user's, not the importer's.
 */
import { computed } from 'vue';
import ConnectionStatus from '../components/ConnectionStatus.vue';
import DeleteLocalData from '../components/DeleteLocalData.vue';
import ImportControls from '../components/ImportControls.vue';
import ImportReport from '../components/ImportReport.vue';
import { useDb } from '../composables/useDb';
import { useImport } from '../composables/useImport';
import { useSelection } from '../composables/useSelection';
import { timeFormat } from '../lib/run/format';

const { ready, error: dbError, retry: retryDb } = useDb();
const { state, connect, reconnect, importFiles, disconnect, retryScan } = useImport();
const { rememberedRunRoute } = useSelection();

const importDisabled = computed(() => !ready.value || dbError.value !== null);

// `state.report` and `state.lastImportAt` already describe the last pass that
// did work — a no-op background poll leaves both alone — so this page renders
// them directly. Guarding here instead would only hold while the page stayed
// mounted, and a trip to Run and back would lose the guard with it.
const lastImport = computed(() => (state.lastImportAt === null ? null : timeFormat.format(new Date(state.lastImportAt))));

function onImportFiles(files: File[]): void {
	void importFiles(files);
}
</script>

<template>
	<div class="data">
		<header class="head">
			<RouterLink class="back" :to="rememberedRunRoute">← Back to Run</RouterLink>
			<p class="eyebrow">Your data</p>
			<h1>Import your stats</h1>
			<p class="lede">
				Point aimcurve at the KovaaK's folder holding <code>stats</code> and <code>performances</code>.
			</p>
			<p class="fine">Fully local: your stats stay in this browser. No server, no account, no tracking.</p>
		</header>

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
		<ImportReport v-if="state.report !== null" :report="state.report" :at="lastImport" />

		<ImportControls
			:connection="state.connection"
			:disabled="importDisabled"
			@connect="connect()"
			@reconnect="reconnect()"
			@disconnect="disconnect()"
			@import-files="onImportFiles"
		/>

		<DeleteLocalData />
	</div>
</template>

<style scoped>
/* The About page's column and type, so the two read as one site. */
.data {
	display: flex;
	flex-direction: column;
	gap: var(--space-6);
	max-width: 1080px;
	margin: 0 auto;
	padding: clamp(1.5rem, 1rem + 3vw, 3.5rem) clamp(1rem, 0.5rem + 2vw, 2rem) 4rem;
}

.head {
	max-width: 44rem;
}

.back {
	display: inline-block;
	margin-bottom: var(--space-6);
	font-size: 0.8125rem;
	color: var(--color-text-faint);
	text-decoration: none;
	transition: color 120ms ease;
}

.back:hover {
	color: var(--color-text);
}

.eyebrow {
	font: 500 12px/1 var(--font-mono);
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--color-accent);
	margin-bottom: var(--space-3);
}

h1 {
	font-size: clamp(1.75rem, 1.3rem + 2vw, 2.5rem);
	line-height: 1.1;
	letter-spacing: -0.02em;
	color: var(--color-text-strong);
}

.lede {
	margin-top: var(--space-3);
	font-size: 1.0625rem;
	color: var(--color-text-muted);
	max-width: 60ch;
}

.fine {
	margin-top: var(--space-2);
	font-size: 0.8125rem;
	color: var(--color-text-faint);
}
</style>
