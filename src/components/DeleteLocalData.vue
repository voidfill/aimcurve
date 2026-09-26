<script setup lang="ts">
/**
 * "Delete local data" on the Data page: puts this browser back to a first
 * visit (see `destroyLocalData` for exactly what that removes). It only ever
 * touches what aimcurve stored here; the user's KovaaK's files stay as they are.
 *
 * Two clicks, because the thing it destroys takes a real ingest to rebuild.
 * The second click is the same button rather than a dialog — a confirm dialog
 * would block the page.
 */
import { onUnmounted, ref } from 'vue';
import { destroyLocalData } from '../db/destroy';

const ARMED_MS = 4000;

const armed = ref(false);
const busy = ref(false);
const failures = ref<string[]>([]);

let disarm: ReturnType<typeof setTimeout> | undefined;

async function click(): Promise<void> {
	if (busy.value) return;

	if (!armed.value) {
		armed.value = true;
		clearTimeout(disarm);
		disarm = setTimeout(() => (armed.value = false), ARMED_MS);
		return;
	}

	clearTimeout(disarm);
	armed.value = false;
	busy.value = true;
	failures.value = await destroyLocalData();
	// A clean wipe loads the bare root, which a first visit sends on to About:
	// the browser is back where a new visitor starts. A partial one stays put,
	// as the page holds the only report of what survived.
	if (failures.value.length === 0) location.replace(location.pathname);
	else busy.value = false;
}

onUnmounted(() => clearTimeout(disarm));
</script>

<template>
	<section class="reset" aria-labelledby="reset-heading">
		<h2 id="reset-heading">Delete local data</h2>
		<p class="what">
			Removes your imported runs, the saved folder link and your aimcurve settings from this browser, then starts
			over from the About page.
			Your KovaaK's files are not touched, so you can import them again at any time.
		</p>
		<button type="button" :class="{ armed }" :disabled="busy" @click="click()">
			{{ busy ? 'Deleting…' : armed ? 'Click again to delete everything' : 'Delete local data' }}
		</button>

		<p v-if="failures.length > 0" class="failed" role="alert">
			Some of it could not be deleted: {{ failures.join('; ') }}
		</p>
	</section>
</template>

<style scoped>
.reset {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--space-2);
	margin-top: var(--space-8);
	padding-top: var(--space-4);
	border-top: 1px solid var(--color-border);
}

h2 {
	font-size: 0.9375rem;
	color: var(--color-text);
}

button {
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: transparent;
	color: var(--color-text-muted);
	padding: var(--space-2) var(--space-3);
	font-size: 0.8125rem;
	font-weight: 600;
	cursor: pointer;
}

button:hover:not(:disabled),
button.armed {
	border-color: var(--color-danger);
	color: var(--color-danger);
}

button:disabled {
	cursor: default;
}

.what,
.failed {
	font-size: 0.8125rem;
}

.what {
	max-width: 70ch;
	color: var(--color-text-muted);
}

.failed {
	color: var(--color-danger);
}
</style>
