<script setup lang="ts">
/**
 * The application bar: brand, the two destinations this slice has, and a
 * persistent data-status link.
 *
 * The Run link points at the last Run location visited, so coming back from
 * Data restores the inspected run, the filter, and whether following was on.
 *
 * The right-hand slot belongs to whichever view fills it: Run puts its
 * selection pill there. It is selection state, never connection state.
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
		<strong class="brand">aim<span>curve</span></strong>
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
		<!-- The Run view teleports its Follow latest / inspecting pill here. -->
		<div id="app-bar-status" class="bar-status"></div>
	</header>
</template>

<style scoped>
header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-3) 24px;
	min-height: 46px;
	padding: var(--space-1) 18px;
	border-bottom: 1px solid var(--color-border);
	background: var(--color-surface);
}

.brand {
	font: 500 13px/1 var(--font-mono);
	letter-spacing: 0.06em;
	color: var(--color-text-faint);
}

.brand span {
	color: var(--color-text);
}

nav {
	display: flex;
	align-items: center;
	gap: 2px;
}

a {
	color: var(--color-text-muted);
	text-decoration: none;
	padding: 6px 11px;
	border-radius: 3px;
	font-size: 12.5px;
}

a:hover {
	color: var(--color-text);
}

a.active {
	color: var(--color-text);
	background: var(--color-surface-raised);
	box-shadow: inset 0 0 0 1px var(--color-border-strong);
}

.data-link {
	display: flex;
	align-items: baseline;
	gap: var(--space-2);
}

.status {
	font: 400 11px/1 var(--font-mono);
	color: var(--color-text-muted);
}

.status.reconnect,
.status.error {
	color: var(--color-danger);
}

.bar-status {
	margin-left: auto;
	display: flex;
	align-items: center;
}
</style>
