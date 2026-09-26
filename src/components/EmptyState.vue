<script setup lang="ts">
/**
 * The first-use state every page shows when the database holds no run: the
 * page's whole content, centered, pointing at Data. While a first import runs
 * it says so; the page swaps to real content by itself once runs land.
 */
import { useImport } from '../composables/useImport';

const { state } = useImport();
</script>

<template>
	<section class="empty" aria-labelledby="empty-heading">
		<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
		</svg>
		<template v-if="state.busy">
			<h1 id="empty-heading">Importing your stats…</h1>
			<p>Runs appear here as they land.</p>
			<RouterLink class="cta" :to="{ name: 'data' }">See progress</RouterLink>
		</template>
		<template v-else>
			<h1 id="empty-heading">No runs yet</h1>
			<p>aimcurve reads the stats Kovaak's writes after every run. Import them to see your progress.</p>
			<RouterLink class="cta" :to="{ name: 'data' }">Import your stats</RouterLink>
			<p class="fine">Fully local: your stats stay in this browser. No server, no account, no tracking.</p>
		</template>
	</section>
</template>

<style scoped>
.empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: var(--space-3);
	/* The viewport below the application bar, less the page's own padding. */
	min-height: calc(100dvh - var(--app-bar-height) - 3rem);
	padding: var(--space-8) var(--space-4);
	text-align: center;
}

.icon {
	width: 2.5rem;
	height: 2.5rem;
	margin-bottom: var(--space-2);
	fill: none;
	stroke: var(--color-text-faint);
	stroke-width: 1.25;
	stroke-linecap: round;
	stroke-linejoin: round;
}

h1 {
	font-size: 1.25rem;
	color: var(--color-text-strong);
}

p {
	max-width: 42ch;
	color: var(--color-text-muted);
}

.cta {
	margin-top: var(--space-2);
	padding: var(--space-2) var(--space-4);
	border-radius: 6px;
	background: var(--color-accent);
	color: var(--color-accent-contrast);
	font-weight: 600;
	text-decoration: none;
}

.cta:hover {
	filter: brightness(1.1);
}

.cta:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}

.fine {
	max-width: none;
	font-size: 0.8125rem;
	color: var(--color-text-faint);
}
</style>
