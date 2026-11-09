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
 *
 * Enter on the row of the run being shown filters the rail to its scenario:
 * that row is already selected, so following its link would change nothing.
 * Enter on any other row follows the link as usual.
 *
 * The background is the score's rank: tinted in the rank's colour up to its
 * progress toward the next rank, with a solid edge along the bottom. The rank
 * is also named in the row's text, so it never rests on colour alone.
 */
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { formatScore } from '../lib/run/format';
import type { RailAttempt } from '../lib/run/queries';
import { formatDelta, isPb, scoreDelta, type RowRank } from '../lib/run/rail';

const props = defineProps<{
	attempt: RailAttempt;
	selected: boolean;
	to: RouteLocationRaw;
	rank: RowRank | null;
}>();

const emit = defineEmits<{ (event: 'filter'): void }>();

function onEnter(event: KeyboardEvent): void {
	if (!props.selected || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	event.preventDefault();
	emit('filter');
}

/** The session header carries the day, so a row needs only the time. */
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

// Computed, not called from the template: a settled pass replaces the whole
// rail array, so every row re-renders, and a method would re-run the `Intl`
// formats on each of them even when the row's own attempt is unchanged.
const startedAt = computed(() => timeFormat.format(new Date(props.attempt.startedAt)));

// Null is absent, not zero.
const score = computed(() => (props.attempt.score === null ? 'No score' : formatScore(props.attempt.score)));

const delta = computed(() => {
	const d = scoreDelta(props.attempt);
	if (d === null) return null;
	return { text: formatDelta(d), tone: d > 0 ? 'ahead' : d < 0 ? 'behind' : 'even' };
});

const pb = computed(() => isPb(props.attempt));

/** No earlier score on the scenario: nothing to compare against. */
const first = computed(() => props.attempt.pbBefore === null && props.attempt.score !== null);

const style = computed(() =>
	props.rank === null
		? undefined
		: { '--rank': props.rank.color, '--rank-text': props.rank.tint, '--fill': `${props.rank.fill * 100}%` },
);
</script>

<template>
	<RouterLink v-slot="{ href, navigate }" :to="to" custom>
		<a
			:href="href"
			class="row"
			:class="{ 'is-selected': selected, ranked: rank !== null }"
			:style="style"
			:aria-current="selected ? 'true' : undefined"
			:title="selected ? 'Enter: show only this scenario' : rank?.label"
			@click="navigate"
			@keydown.enter="onEnter"
		>
			<span class="scenario">{{ attempt.scenarioName }}</span>
			<span class="score" :class="{ absent: attempt.score === null }">{{ score }}</span>
			<span class="meta">
				<span>{{ startedAt }}</span>
				<span v-if="!attempt.hasPerf" title="No performance detail was imported for this run">· no detail</span>
				<template v-if="rank !== null">
					<span class="rank" aria-hidden="true">· {{ rank.name }}</span>
					<span class="sr-only">· {{ rank.label }}</span>
				</template>
			</span>
			<span class="change">
				<span v-if="pb" class="pb" title="A new personal best when it was played">PB</span>
				<span v-if="delta !== null && !first" :class="delta.tone" title="Change from the previous attempt at this scenario">{{
					delta.text
				}}</span>
				<span v-else-if="first" class="even">first</span>
			</span>
		</a>
	</RouterLink>
</template>

<style scoped>
.row {
	position: relative;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 0 var(--space-2);
	padding: 5px var(--space-3) 7px;
	border: 1px solid transparent;
	border-radius: 5px;
	overflow: hidden;
	color: var(--color-text);
	text-decoration: none;
	line-height: 1.35;
}

.row:hover {
	background-color: var(--color-surface-raised);
}

.row.is-selected {
	background-color: var(--color-surface-raised);
	border-color: var(--color-accent);
}

/* Progress within the rank: a quiet tint behind the text and a solid edge below it. */
.row.ranked {
	background-image: linear-gradient(
		90deg,
		color-mix(in srgb, var(--rank) 16%, transparent) var(--fill),
		transparent var(--fill)
	);
}

.row.ranked::after {
	content: '';
	position: absolute;
	left: 0;
	bottom: 0;
	width: var(--fill);
	height: 2px;
	background: var(--rank);
}

.scenario {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.score {
	font-family: var(--font-mono);
	text-align: right;
}

.score.absent {
	color: var(--color-text-muted);
	font-family: var(--font-sans);
	font-size: 0.8125rem;
}

.meta,
.change {
	color: var(--color-text-muted);
	font-size: 0.75rem;
}

.meta {
	display: flex;
	gap: 0.3em;
	min-width: 0;
	overflow: hidden;
	white-space: nowrap;
}

/* The rank's name, in its colour made readable on the dark page. */
.rank {
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--rank-text, var(--color-text-muted));
}

.change {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: var(--space-1);
	font-family: var(--font-mono);
}

.ahead {
	color: var(--color-ahead);
}

.behind {
	color: var(--color-behind);
}

.even {
	color: var(--color-text-muted);
}

.pb {
	padding: 0 4px;
	border-radius: 3px;
	background: var(--color-baseline);
	color: var(--color-accent-contrast);
	font-family: var(--font-sans);
	font-size: 0.6875rem;
	font-weight: 600;
}
</style>
