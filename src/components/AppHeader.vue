<script setup lang="ts">
/**
 * The application bar: brand, the two destinations this slice has, and a
 * persistent data-status link.
 *
 * The Run link points at the last Run location visited, so coming back from
 * Data restores the inspected run, the filter, and whether following was on.
 *
 * Only Run and Data exist here. Sessions, Scenarios and Benchmarks are later
 * slices and are deliberately absent rather than present and dead.
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useImport } from '../composables/useImport';
import { useSelection } from '../composables/useSelection';
import type { Connection } from '../lib/run/import-controller';

const route = useRoute();
const { state } = useImport();
const { rememberedRunRoute } = useSelection();

const STATUS: Record<Connection, string> = {
	none: 'Not connected',
	connected: 'Connected',
	reconnect: 'Reconnect needed',
	snapshot: 'Snapshot',
	error: 'Import failed',
};

const status = computed(() => (state.busy ? 'Importing…' : STATUS[state.connection]));
const onRun = computed(() => route.name === 'run');
const onData = computed(() => route.name === 'data');
</script>

<template>
	<header>
		<strong class="brand">aimcurve</strong>
		<nav aria-label="Primary">
			<RouterLink v-slot="{ href, navigate }" :to="rememberedRunRoute" custom>
				<a
					:href="href"
					:class="{ active: onRun }"
					:aria-current="onRun ? 'page' : undefined"
					@click="navigate"
					>Run</a
				>
			</RouterLink>
			<RouterLink
				:to="{ name: 'data' }"
				class="data-link"
				:class="{ active: onData }"
				:aria-current="onData ? 'page' : undefined"
			>
				<span>Data</span>
				<span class="status" :class="state.connection">{{ status }}</span>
			</RouterLink>
		</nav>
	</header>
</template>

<style scoped>
header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--space-3);
	padding: var(--space-3) var(--space-4);
	border-bottom: 1px solid var(--color-border);
	background: var(--color-surface);
}

.brand {
	letter-spacing: 0.02em;
}

nav {
	display: flex;
	align-items: center;
	gap: var(--space-4);
}

a {
	color: var(--color-text);
	text-decoration: none;
	padding: var(--space-1) var(--space-2);
	border-radius: 6px;
}

a:hover {
	background: var(--color-bg);
}

a.active {
	color: var(--color-accent);
}

.data-link {
	display: flex;
	align-items: baseline;
	gap: var(--space-2);
}

.status {
	color: var(--color-text-muted);
	font-size: 0.8125rem;
}

.status.reconnect,
.status.error {
	color: var(--color-danger);
}
</style>
