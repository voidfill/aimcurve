<script setup lang="ts">
/**
 * What the database and the import connection are actually doing.
 *
 * A failed database must never look like an empty successful one, so a startup
 * failure is its own block with its own Retry, and while it is showing, import
 * stays disabled — there is nothing to import into.
 */
import { computed } from 'vue';
import type { Connection } from '../lib/run/import-controller';
import type { MigrateResult } from '../db/migrate';

const props = defineProps<{
	connection: Connection;
	busy: boolean;
	message: string | null;
	dbReady: boolean;
	dbError: Error | null;
	migration: MigrateResult | null;
}>();

const emit = defineEmits<{ (event: 'retry-db'): void }>();

const LABELS: Record<Connection, string> = {
	none: 'No folder connected',
	connected: 'Folder connected',
	reconnect: 'Reconnect needed',
	snapshot: 'One-time snapshot imported',
	error: 'Last import attempt failed',
};

const label = computed(() => LABELS[props.connection]);
</script>

<template>
	<section class="status" aria-labelledby="status-heading">
		<h2 id="status-heading">Status</h2>

		<div v-if="dbError !== null" class="block danger" role="alert">
			<p><strong>The local database could not be opened.</strong></p>
			<p>{{ dbError.message }}</p>
			<p>
				Nothing was lost and nothing was deleted; this browser simply could not start the database, so
				importing is unavailable until it does. Private windows and blocked site data are the usual
				causes.
			</p>
			<button type="button" @click="emit('retry-db')">Retry</button>
		</div>

		<p v-else-if="!dbReady" class="muted">Starting the local database…</p>

		<div v-if="migration !== null && migration.reset" class="block warn">
			<p><strong>Imported data was reset by a database update.</strong></p>
			<p>{{ migration.reason }}</p>
			<p>
				Your stats files were not touched. Import them again below — a connected folder needs a
				reconnect first, and a snapshot needs the same files selected again.
			</p>
		</div>

		<p class="connection">
			<span class="dot" :class="connection" aria-hidden="true"></span>
			<span>{{ label }}</span>
			<span v-if="busy" class="muted">Working…</span>
		</p>

		<p v-if="message !== null" class="message">{{ message }}</p>
	</section>
</template>

<style scoped>
.status {
	display: flex;
	flex-direction: column;
	gap: var(--space-3);
}

h2 {
	font-size: 1.125rem;
}

.block {
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
	padding: var(--space-3);
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: var(--color-surface);
	font-size: 0.9375rem;
}

.block.danger {
	border-color: var(--color-danger);
}

.block.warn {
	border-color: var(--color-accent);
}

.connection {
	display: flex;
	align-items: center;
	gap: var(--space-2);
}

.dot {
	width: 0.6rem;
	height: 0.6rem;
	border-radius: 50%;
	background: var(--color-text-muted);
}

.dot.connected {
	background: var(--color-accent);
}

.dot.error,
.dot.reconnect {
	background: var(--color-danger);
}

.message,
.muted {
	color: var(--color-text-muted);
	font-size: 0.9375rem;
}

button {
	align-self: flex-start;
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
