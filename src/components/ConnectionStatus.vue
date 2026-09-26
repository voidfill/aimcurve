<script setup lang="ts">
/**
 * One card that says what is happening right now: the connection, the pass in
 * flight, and the single action that fixes a stuck state.
 *
 * A failed database must never look like an empty successful one, so a startup
 * failure replaces the card entirely and import stays disabled while it shows —
 * there is nothing to import into.
 */
import { computed } from 'vue';
import ProgressBar from './ProgressBar.vue';
import type { Connection } from '../lib/run/import-controller';

const props = defineProps<{
	connection: Connection;
	busy: boolean;
	progress: { done: number; total: number } | null;
	message: string | null;
	dbReady: boolean;
	dbError: Error | null;
}>();

const emit = defineEmits<{ (event: 'retry-db'): void; (event: 'retry-scan'): void }>();

const LABELS: Record<Connection, string> = {
	none: 'No folder connected',
	connected: 'Folder connected',
	reconnect: 'Reconnect needed',
	snapshot: 'Files imported',
	error: 'Last scan failed',
};

const label = computed(() => (props.busy ? 'Importing' : LABELS[props.connection]));

/** `error` is the only state a plain retry can clear; the rest need a pick. */
const canRetryScan = computed(() => props.connection === 'error' && !props.busy);
</script>

<template>
	<section class="status" aria-labelledby="status-heading">
		<h2 id="status-heading" class="sr-only">Status</h2>

		<div v-if="dbError !== null" class="card danger" role="alert">
			<p><strong>This browser could not start the local database.</strong></p>
			<p class="muted">{{ dbError.message }}</p>
			<button type="button" @click="emit('retry-db')">Try again</button>
		</div>

		<div v-else class="card" :class="{ busy }">
			<div class="line">
				<span class="dot" :class="busy ? 'working' : connection" aria-hidden="true"></span>
				<span class="label">{{ dbReady ? label : 'Starting up' }}</span>
				<button v-if="canRetryScan" type="button" class="ghost" @click="emit('retry-scan')">
					Retry
				</button>
			</div>

			<ProgressBar
				v-if="busy"
				:done="progress?.done ?? 0"
				:total="progress?.total ?? 0"
				label="Import progress"
			/>

			<p v-if="message !== null" class="muted selectable">{{ message }}</p>
		</div>
	</section>
</template>

<style scoped>
.card {
	display: flex;
	flex-direction: column;
	gap: var(--space-3);
	padding: var(--space-4);
	border: 1px solid var(--color-border);
	border-radius: 12px;
	background: var(--color-surface);
}

.card.busy {
	border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
}

.card.danger {
	border-color: var(--color-danger);
	background: color-mix(in srgb, var(--color-danger) 8%, var(--color-surface));
}

.line {
	display: flex;
	align-items: center;
	gap: var(--space-3);
}

.label {
	font-weight: 600;
}

.dot {
	flex: none;
	width: 0.5rem;
	height: 0.5rem;
	border-radius: 50%;
	background: var(--color-text-muted);
	box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-text-muted) 18%, transparent);
}

.dot.connected,
.dot.snapshot,
.dot.working {
	background: var(--color-accent);
	box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 22%, transparent);
}

.dot.error,
.dot.reconnect {
	background: var(--color-danger);
	box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-danger) 22%, transparent);
}

.muted {
	color: var(--color-text-muted);
	font-size: 0.875rem;
	max-width: 68ch;
}

button {
	margin-left: auto;
	background: transparent;
	border: 1px solid var(--color-border);
	border-radius: 999px;
	padding: var(--space-1) var(--space-3);
	font-size: 0.875rem;
	cursor: pointer;
}

button:hover {
	border-color: var(--color-accent);
	color: var(--color-accent);
}

.card.danger button {
	margin-left: 0;
	align-self: flex-start;
}
</style>
