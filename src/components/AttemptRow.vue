<script setup lang="ts">
/**
 * One row of the attempt rail.
 *
 * A real `RouterLink`, so a middle click or a ctrl/cmd click opens the run in a
 * new tab exactly as any other link would — vue-router's own click guard
 * excludes modified clicks from the in-app navigation. The `custom` slot is
 * used only so `aria-current` states *selection*, which is not the same thing
 * as route-exact-active: while following, the selected row's link is not the
 * current URL.
 */
import type { RouteLocationRaw } from 'vue-router';
import type { Attempt } from '../lib/run/queries';

const props = defineProps<{
	attempt: Attempt;
	selected: boolean;
	to: RouteLocationRaw;
}>();

const timeFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'short',
	timeStyle: 'short',
});
const scoreFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function startedAt(): string {
	return timeFormat.format(new Date(props.attempt.startedAt));
}

function score(): string {
	// Null is absent, not zero.
	return props.attempt.score === null ? 'No score recorded' : scoreFormat.format(props.attempt.score);
}
</script>

<template>
	<RouterLink v-slot="{ href, navigate }" :to="to" custom>
		<a
			:href="href"
			class="row"
			:class="{ 'is-selected': selected }"
			:aria-current="selected ? 'true' : undefined"
			@click="navigate"
		>
			<span class="time">{{ startedAt() }}</span>
			<span class="scenario">{{ attempt.scenarioName }}</span>
			<span class="score" :class="{ absent: attempt.score === null }">{{ score() }}</span>
			<span v-if="!attempt.hasPerf" class="detail">No performance detail</span>
		</a>
	</RouterLink>
</template>

<style scoped>
.row {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 0 var(--space-2);
	padding: var(--space-2) var(--space-3);
	border: 1px solid transparent;
	border-radius: 6px;
	color: var(--color-text);
	text-decoration: none;
}

.row:hover {
	background: var(--color-surface);
}

.row.is-selected {
	background: var(--color-surface);
	border-color: var(--color-accent);
}

.time {
	color: var(--color-text-muted);
	font-size: 0.8125rem;
}

.scenario {
	grid-column: 1;
	overflow-wrap: anywhere;
}

.score {
	grid-row: 2;
	grid-column: 2;
	align-self: center;
	font-family: var(--font-mono);
}

.score.absent {
	color: var(--color-text-muted);
	font-family: var(--font-sans);
	font-size: 0.8125rem;
}

.detail {
	grid-column: 1 / -1;
	color: var(--color-text-muted);
	font-size: 0.75rem;
}
</style>
