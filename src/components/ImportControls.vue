<script setup lang="ts">
/**
 * The two ways in: connect the stats folder, or hand over a set of files once.
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
	disabled: boolean;
}>();

const emit = defineEmits<{
	(event: 'connect'): void;
	(event: 'reconnect'): void;
	(event: 'disconnect'): void;
	(event: 'import-files', files: File[]): void;
}>();

const canConnect = canPickDirectory();

/**
 * `connected`, `reconnect` and `error` all leave something to drop: a live
 * watcher, a stored folder permission, or both. `none` has nothing and
 * `snapshot` has nothing either — its handle is already cleared and nothing is
 * watched — so offering it there would name a connection that does not exist.
 */
const canDisconnect = computed(() => props.connection !== 'none' && props.connection !== 'snapshot');

const needsReconnect = computed(() => props.connection === 'reconnect');
const showConnect = computed(() => canConnect && props.connection !== 'connected' && !needsReconnect.value);

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
		<div class="intro">
			<h2 id="controls-heading">Import your stats</h2>
			<p>
				Point aimcurve at your Kovaak's <code>FPSAimTrainer/stats</code> folder. Everything stays in
				this browser — nothing is uploaded.
			</p>
		</div>

		<div class="options">
			<article class="option" :class="{ active: connection === 'connected' }">
				<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
				</svg>
				<h3>Connect the folder</h3>
				<p>New attempts show up on their own while this page is open.</p>

				<div class="actions">
					<button v-if="needsReconnect" type="button" :disabled="disabled" @click="emit('reconnect')">
						Reconnect
					</button>
					<button v-if="showConnect" type="button" :disabled="disabled" @click="emit('connect')">
						Connect folder
					</button>
					<button
						v-if="needsReconnect && canConnect"
						type="button"
						class="ghost"
						:disabled="disabled"
						@click="emit('connect')"
					>
						Use another folder
					</button>
					<button
						v-if="canDisconnect"
						type="button"
						class="ghost"
						:disabled="disabled"
						@click="emit('disconnect')"
					>
						Disconnect
					</button>
				</div>

				<p v-if="!canConnect" class="note">Not supported in this browser — import files instead.</p>
			</article>

			<article class="option" :class="{ active: connection === 'snapshot' }">
				<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
				</svg>
				<h3>Import files once</h3>
				<p>A one-time copy. Works everywhere, but does not update on its own.</p>

				<div class="actions">
					<label class="picker" :class="{ disabled }">
						<span>Choose folder</span>
						<input type="file" webkitdirectory multiple :disabled="disabled" @change="onFiles" />
					</label>
					<label class="picker ghost" :class="{ disabled }">
						<span>Choose files</span>
						<input type="file" multiple accept=".csv,.perf" :disabled="disabled" @change="onFiles" />
					</label>
				</div>
			</article>
		</div>
	</section>
</template>

<style scoped>
.controls {
	display: flex;
	flex-direction: column;
	gap: var(--space-4);
}

.intro {
	display: flex;
	flex-direction: column;
	gap: var(--space-1);
}

h2 {
	font-size: 1.125rem;
}

.intro p {
	color: var(--color-text-muted);
	font-size: 0.9375rem;
	max-width: 60ch;
}

.options {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
	gap: var(--space-4);
}

.option {
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
	padding: var(--space-4);
	border: 1px solid var(--color-border);
	border-radius: 12px;
	background: var(--color-surface);
}

.option.active {
	border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border));
	background: color-mix(in srgb, var(--color-accent) 7%, var(--color-surface));
}

.icon {
	width: 1.5rem;
	height: 1.5rem;
	fill: none;
	stroke: var(--color-accent);
	stroke-width: 1.5;
	stroke-linecap: round;
	stroke-linejoin: round;
}

h3 {
	font-size: 1rem;
}

.option p {
	color: var(--color-text-muted);
	font-size: 0.875rem;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2);
	margin-top: auto;
	padding-top: var(--space-2);
}

button,
.picker {
	position: relative;
	display: inline-flex;
	align-items: center;
	background: var(--color-accent);
	color: var(--color-accent-contrast);
	border: 1px solid var(--color-accent);
	border-radius: 8px;
	padding: var(--space-2) var(--space-4);
	font-size: 0.875rem;
	font-weight: 600;
	cursor: pointer;
}

button:hover:not(:disabled),
.picker:not(.disabled):hover {
	filter: brightness(1.08);
}

.ghost {
	background: transparent;
	color: var(--color-text);
	border-color: var(--color-border);
}

.ghost:hover:not(:disabled),
.picker.ghost:not(.disabled):hover {
	border-color: var(--color-accent);
	color: var(--color-accent);
	filter: none;
}

button:disabled,
.picker.disabled {
	background: transparent;
	color: var(--color-text-muted);
	border-color: var(--color-border);
	cursor: default;
	filter: none;
}

/* The input is hidden, so the label has to carry its focus ring. */
.picker:has(input:focus-visible) {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}

.picker input {
	position: absolute;
	width: 1px;
	height: 1px;
	opacity: 0;
	pointer-events: none;
}

.note {
	font-size: 0.8125rem;
}
</style>
