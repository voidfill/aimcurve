<script setup lang="ts">
/**
 * Every way into the import lifecycle: connect a folder, reconnect it, drop
 * the connection, import a snapshot, retry a failed scan.
 *
 * Disconnect removes the stored folder permission and stops the watching. It
 * removes no imported rows, and this slice deliberately offers no control that
 * deletes local data.
 *
 * The click handlers call straight through: the controller needs the user
 * activation of the click to open a directory picker, so nothing may be
 * awaited before it.
 */
import { computed } from 'vue';
import { canPickDirectory, type Connection } from '../lib/run/import-controller';

const props = defineProps<{
	connection: Connection;
	busy: boolean;
	disabled: boolean;
}>();

/**
 * `connected`, `reconnect` and `error` all leave something to drop: a live
 * watcher, a stored folder permission, or both. `none` has nothing and
 * `snapshot` has nothing either — its handle is already cleared and nothing is
 * watched — so offering it there would name a connection that does not exist.
 */
const canDisconnect = computed(() => props.connection !== 'none' && props.connection !== 'snapshot');

const emit = defineEmits<{
	(event: 'connect'): void;
	(event: 'reconnect'): void;
	(event: 'disconnect'): void;
	(event: 'retry-scan'): void;
	(event: 'import-files', files: File[]): void;
}>();

const canConnect = canPickDirectory();

/**
 * The controller copies the `FileList` before its first await, so clearing the
 * input right here is safe — and it is what lets the very same selection be
 * imported again, since an unchanged value fires no `change` event.
 */
function onFiles(event: Event): void {
	const input = event.target as HTMLInputElement;
	const files = input.files;
	if (files !== null && files.length > 0) emit('import-files', Array.from(files));
	input.value = '';
}
</script>

<template>
	<section class="controls" aria-labelledby="controls-heading">
		<h2 id="controls-heading">Import</h2>

		<p class="lead">
			Select your Kovaak's <code>FPSAimTrainer/stats</code> folder, or a set of files from it. Everything
			is read and stored in this browser: nothing is uploaded, nothing is installed, nothing is shared,
			and nothing syncs to your other devices.
		</p>

		<div class="buttons">
			<button v-if="canConnect && connection !== 'connected'" type="button" :disabled="disabled" @click="emit('connect')">
				Connect folder
			</button>
			<button v-if="connection === 'reconnect'" type="button" :disabled="disabled" @click="emit('reconnect')">
				Reconnect
			</button>
			<!--
				Offered in every state where a folder is still connected, still
				stored, or still being polled — not just the healthy one. In
				`reconnect` a handle sits in this browser with nothing else to
				forget it, and in `error` the folder is still being checked. Not
				offered for `snapshot`: nothing is connected there to disconnect.
			-->
			<button v-if="canDisconnect" type="button" :disabled="disabled" @click="emit('disconnect')">
				Disconnect folder
			</button>
			<button v-if="connection === 'error'" type="button" :disabled="disabled || busy" @click="emit('retry-scan')">
				Retry scan
			</button>
		</div>

		<p v-if="canDisconnect" class="muted">
			Disconnecting forgets this browser's permission for the folder and stops checking it. Attempts
			already imported stay exactly as they are.
		</p>

		<p v-if="!canConnect" class="muted">
			This browser cannot connect to a folder. Import a snapshot of your stats files instead — it works
			everywhere, but it is a one-time import.
		</p>

		<div class="pickers">
			<label>
				<span>Import a folder snapshot</span>
				<input type="file" webkitdirectory multiple :disabled="disabled" @change="onFiles" />
			</label>
			<label>
				<span>Import individual files</span>
				<input
					type="file"
					multiple
					accept=".csv,.perf"
					:disabled="disabled"
					@change="onFiles"
				/>
			</label>
		</div>

		<p v-if="connection === 'snapshot'" class="muted">
			A snapshot does not update on its own. Select the same files again whenever you want the attempts
			you have completed since.
		</p>
	</section>
</template>

<style scoped>
.controls {
	display: flex;
	flex-direction: column;
	gap: var(--space-3);
}

h2 {
	font-size: 1.125rem;
}

.lead {
	font-size: 0.9375rem;
	max-width: 60ch;
}

.buttons {
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2);
}

button {
	background: var(--color-accent);
	color: var(--color-accent-contrast);
	border: 1px solid var(--color-accent);
	border-radius: 6px;
	padding: var(--space-2) var(--space-4);
	cursor: pointer;
	font-weight: 600;
}

button:disabled {
	background: transparent;
	color: var(--color-text-muted);
	border-color: var(--color-border);
	cursor: default;
}

.pickers {
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-4);
}

label {
	display: flex;
	flex-direction: column;
	gap: var(--space-1);
	font-size: 0.875rem;
	color: var(--color-text-muted);
}

.muted {
	color: var(--color-text-muted);
	font-size: 0.875rem;
	max-width: 60ch;
}
</style>
