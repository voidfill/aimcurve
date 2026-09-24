<script setup lang="ts">
/**
 * Follow latest vs inspecting, in the application bar (Run view R1).
 *
 * Selection state only: whether new imports become the selection. The data
 * connection's own status stays on the Data link.
 */
import type { SelectionMode } from '../composables/useSelection';

defineProps<{
	mode: SelectionMode;
	/** The inspected run's start, already formatted. */
	inspectedAt: string | null;
	hasNewer: boolean;
}>();

const emit = defineEmits<{ (event: 'resume-latest'): void }>();
</script>

<template>
	<div class="selection" role="status">
		<span v-if="mode === 'follow'" class="pill live">
			<i aria-hidden="true"></i>
			following live
		</span>
		<template v-else>
			<span class="pill inspecting">
				<i aria-hidden="true"></i>
				inspecting{{ inspectedAt ? ` ${inspectedAt}` : '' }} · paused
			</span>
			<button type="button" @click="emit('resume-latest')">
				{{ hasNewer ? 'new run · ' : '' }}return to live ›
			</button>
		</template>
	</div>
</template>

<style scoped>
.selection {
	display: flex;
	align-items: center;
	gap: 10px;
}

.pill {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 4px 10px;
	border-radius: 3px;
	font: 500 10.5px/1 var(--font-mono);
	letter-spacing: 0.14em;
	text-transform: uppercase;
}

.pill i {
	width: 6px;
	height: 6px;
}

.live {
	color: var(--color-ahead);
	background: rgb(67 212 146 / 0.1);
	box-shadow: inset 0 0 0 1px rgb(67 212 146 / 0.32);
}

.live i {
	border-radius: 50%;
	background: var(--color-ahead);
	animation: pulse 1.8s ease-in-out infinite;
}

.inspecting {
	color: var(--color-baseline);
	background: rgb(240 178 63 / 0.1);
	box-shadow: inset 0 0 0 1px rgb(240 178 63 / 0.34);
}

.inspecting i {
	border-radius: 1px;
	background: var(--color-baseline);
}

button {
	cursor: pointer;
	background: var(--color-surface-raised);
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	padding: 5px 9px;
	font: 400 11px/1 var(--font-mono);
	color: var(--color-text-muted);
}

button:hover {
	color: var(--color-text);
	border-color: var(--color-accent);
}

@keyframes pulse {
	50% {
		opacity: 0.3;
	}
}
</style>
