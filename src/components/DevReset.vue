<script setup lang="ts">
/**
 * The development-only wipe. Never reaches a production bundle: `DataView`
 * imports it behind a statically false condition, so the chunk is dropped.
 *
 * Two clicks, because the thing it destroys takes a real ingest to rebuild.
 * The second click is the same button rather than a dialog — a confirm dialog
 * would block the page, and this is a button pressed dozens of times a day.
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
	// A clean wipe reloads into a first-visit app. A partial one stays put:
	// the page still holds the only report of what survived.
	if (failures.value.length === 0) location.reload();
	else busy.value = false;
}

onUnmounted(() => clearTimeout(disarm));
</script>

<template>
	<section class="dev">
		<span class="tag">dev</span>
		<button type="button" :class="{ armed }" :disabled="busy" @click="click()">
			{{ busy ? 'Destroying…' : armed ? 'Really? This deletes everything' : 'Destroy local data' }}
		</button>
		<p class="what">Database, saved folder and import record, then a reload.</p>

		<p v-if="failures.length > 0" class="failed" role="alert">
			Still there — {{ failures.join('; ') }}
		</p>
	</section>
</template>

<style scoped>
.dev {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-3);
	margin-top: var(--space-8);
	padding-top: var(--space-4);
	border-top: 1px dashed var(--color-border);
}

.tag {
	padding: 0 var(--space-2);
	border: 1px solid var(--color-border);
	border-radius: 999px;
	color: var(--color-text-muted);
	font-size: 0.6875rem;
	letter-spacing: 0.08em;
	text-transform: uppercase;
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
	color: var(--color-text-muted);
}

.failed {
	flex-basis: 100%;
	color: var(--color-danger);
}
</style>
