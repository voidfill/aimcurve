<script setup lang="ts">
/**
 * The application bar: brand and destinations on the left, then the view's
 * own status, then the data control at the far right.
 *
 * The Run link points at the last Run location visited, so coming back from
 * Data restores the inspected run, the filter, and whether following was on.
 *
 * The status slot belongs to whichever view fills it: Run puts its selection
 * pill there. It is selection state, never connection state; connection state
 * is the import control's, and that control is also the way to the Data page.
 *
 * The Scenarios link likewise points at the last directory location, so the
 * search and sort survive a trip into a scenario. It is also the active tab on
 * scenario pages, which sit under the directory (L1 of its design). Sessions
 * and Benchmarks are later slices and are deliberately absent rather than
 * present and dead.
 *
 * About is a quiet text link beside the data control, not a tab: it is where
 * first-time visitors land, not a place regulars work in.
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import ImportButton from './ImportButton.vue';
import { useDirectoryRoute } from '../composables/useScenarioDirectory';
import { useSelection } from '../composables/useSelection';

const route = useRoute();
const { rememberedRunRoute } = useSelection();
const { rememberedRoute: rememberedScenariosRoute } = useDirectoryRoute();

const onRun = computed(() => route.name === 'run');
const onScenarios = computed(() => route.name === 'scenarios' || route.name === 'scenario');
const onAbout = computed(() => route.name === 'about');
</script>

<template>
	<header>
		<RouterLink v-slot="{ href, navigate }" :to="rememberedRunRoute" custom>
			<a :href="href" class="brand" @click="navigate">aim<span>curve</span></a>
		</RouterLink>
		<nav aria-label="Primary">
			<RouterLink v-slot="{ href, navigate }" :to="rememberedRunRoute" custom>
				<a
					:href="href"
					class="tab"
					:class="{ active: onRun }"
					:aria-current="onRun ? 'page' : undefined"
					@click="navigate"
					><span>Run</span></a
				>
			</RouterLink>
			<RouterLink v-slot="{ href, navigate }" :to="rememberedScenariosRoute" custom>
				<a
					:href="href"
					class="tab"
					:class="{ active: onScenarios }"
					:aria-current="onScenarios ? 'page' : undefined"
					@click="navigate"
					><span>Scenarios</span></a
				>
			</RouterLink>
		</nav>
		<!-- The Run view teleports its Follow latest / inspecting pill here. -->
		<div id="app-bar-status" class="bar-status"></div>
		<RouterLink
			class="about"
			:class="{ active: onAbout }"
			:to="{ name: 'about' }"
			:aria-current="onAbout ? 'page' : undefined"
			>About</RouterLink
		>
		<ImportButton />
	</header>
</template>

<style scoped>
header {
	display: flex;
	flex-wrap: wrap;
	align-items: stretch;
	column-gap: 20px;
	min-height: 46px;
	padding: 0 18px;
	border-bottom: 1px solid var(--color-border);
	background: var(--color-surface);
}

header > * {
	align-self: center;
}

.brand {
	font: 500 13px/1 var(--font-mono);
	letter-spacing: 0.06em;
	color: var(--color-text-faint);
	text-decoration: none;
	transition: color 120ms ease;
}

.brand span {
	color: var(--color-text);
}

.brand:hover {
	color: var(--color-text-muted);
}

nav {
	display: flex;
	align-self: stretch;
	gap: 2px;
}

/*
 * The tab fills the bar's height so its underline can sit on the bar's bottom
 * border; the hover wash is on the label, so it stays a compact pill.
 */
.tab {
	position: relative;
	display: flex;
	align-items: center;
	color: var(--color-text-muted);
	text-decoration: none;
	font-size: 12.5px;
}

.tab span {
	padding: 6px 11px;
	border-radius: 5px;
	transition:
		background-color 120ms ease,
		color 120ms ease;
}

.tab:hover span {
	color: var(--color-text-strong);
	background: color-mix(in srgb, var(--color-text) 7%, transparent);
}

.tab::after {
	content: '';
	position: absolute;
	left: 8px;
	right: 8px;
	bottom: -1px;
	height: 2px;
	border-radius: 2px 2px 0 0;
	background: var(--color-accent);
	transform: scaleX(0);
	transition: transform 160ms ease;
}

.tab.active {
	color: var(--color-text);
}

.tab.active::after {
	transform: scaleX(1);
}

.tab:focus-visible {
	outline: none;
}

.tab:focus-visible span {
	outline: 2px solid var(--color-accent);
	outline-offset: 1px;
}

.bar-status {
	margin-left: auto;
	display: flex;
	align-items: center;
}

.about {
	font-size: 12.5px;
	color: var(--color-text-faint);
	text-decoration: none;
	transition: color 120ms ease;
}

.about:hover,
.about.active {
	color: var(--color-text);
}
</style>
