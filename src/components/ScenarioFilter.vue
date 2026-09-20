<script setup lang="ts">
/**
 * The scenario filter, bound to the `scenario` query parameter.
 *
 * Options carry a short form of the scenario's content hash, because two
 * scenarios can share a display name when an edited scenario is re-ingested
 * under a new hash. They are distinct scenarios and are never merged, so the
 * label has to keep them apart. The data layer always deals in the full hash;
 * shortening is presentation only.
 */
import { computed } from 'vue';
import type { ScenarioOption } from '../lib/run/queries';
import type { FilterState } from '../composables/useAttempts';

const props = defineProps<{
	options: ScenarioOption[];
	selected: string | null;
	state: FilterState;
	error: string | null;
}>();

const emit = defineEmits<{ (event: 'change', hash: string | null): void }>();

const ALL = '';

function shortHash(hash: string): string {
	return hash.slice(0, 8);
}

function label(option: ScenarioOption): string {
	return `${option.name} · ${shortHash(option.hash)}`;
}

const value = computed(() => props.selected ?? ALL);

function onChange(event: Event): void {
	const next = (event.target as HTMLSelectElement).value;
	emit('change', next === ALL ? null : next);
}
</script>

<template>
	<div class="filter">
		<label for="scenario-filter">Scenario</label>
		<select id="scenario-filter" :value="value" @change="onChange">
			<option :value="ALL">All scenarios</option>
			<!--
				An unresolved hash gets an option of its own rather than falling
				back to "All scenarios", which would silently widen the filter.
			-->
			<option v-if="state === 'unknown' && selected !== null" :value="selected">
				Unknown scenario · {{ shortHash(selected) }}
			</option>
			<option v-for="option in options" :key="option.hash" :value="option.hash">
				{{ label(option) }}
			</option>
		</select>
		<button v-if="selected !== null" type="button" @click="emit('change', null)">Clear filter</button>
		<p v-if="error !== null" class="error">Scenarios could not be listed. {{ error }}</p>
		<p v-else-if="state === 'pending'" class="muted">Loading scenarios…</p>
	</div>
</template>

<style scoped>
.filter {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2);
}

label {
	color: var(--color-text-muted);
	font-size: 0.875rem;
}

select,
button {
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: 6px;
	padding: var(--space-1) var(--space-2);
}

button {
	cursor: pointer;
}

button:hover {
	border-color: var(--color-accent);
}

.error,
.muted {
	flex-basis: 100%;
	font-size: 0.875rem;
}

.error {
	color: var(--color-danger);
}

.muted {
	color: var(--color-text-muted);
}
</style>
