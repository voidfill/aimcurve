<script setup lang="ts">
/**
 * The selected attempt's result.
 *
 * Neutral labels only: this slice does not know whether a scenario scores up
 * or down, so it reports the recorded score and the elapsed duration and makes
 * no claim about which is better. No comparison, no personal-best delta, no
 * chart and no bot breakdown — those are later slices, and a placeholder for
 * them would be a promise this build cannot keep.
 *
 * A null is absent, never zero: every field below says so in words.
 */
import { computed } from 'vue';
import type { Attempt } from '../lib/run/queries';

const props = defineProps<{ attempt: Attempt }>();

const ABSENT = 'Not recorded';

const timeFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'medium',
});
const scoreFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat(undefined, {
	style: 'percent',
	maximumFractionDigits: 1,
});
const sensFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

const startedAt = computed(() => timeFormat.format(new Date(props.attempt.startedAt)));

const score = computed(() =>
	props.attempt.score === null ? ABSENT : scoreFormat.format(props.attempt.score),
);

const duration = computed(() => {
	const seconds = props.attempt.durationS;
	if (seconds < 60) return `${scoreFormat.format(seconds)} s`;
	const whole = Math.floor(seconds);
	const minutes = Math.floor(whole / 60);
	return `${minutes} min ${String(whole % 60).padStart(2, '0')} s`;
});

const accuracy = computed(() =>
	props.attempt.accuracy === null
		? 'Not recorded (no shots)'
		: percentFormat.format(props.attempt.accuracy),
);

const sensitivity = computed(() => {
	const { sensScale, horizSens, vertSens } = props.attempt;
	const horiz = sensFormat.format(horizSens);
	const vert = sensFormat.format(vertSens);
	const value = horiz === vert ? horiz : `${horiz} / ${vert}`;
	return `${value} (${sensScale})`;
});
</script>

<template>
	<section class="summary" aria-labelledby="summary-heading">
		<h1 id="summary-heading">{{ attempt.scenarioName }}</h1>
		<p class="meta">
			<span>{{ startedAt }}</span>
			<span class="stem">{{ attempt.fileStem }}</span>
		</p>

		<dl class="stats">
			<div>
				<dt>Recorded score</dt>
				<dd :class="{ absent: attempt.score === null }">{{ score }}</dd>
			</div>
			<div>
				<dt>Elapsed duration</dt>
				<dd>{{ duration }}</dd>
			</div>
			<div>
				<dt>Accuracy</dt>
				<dd :class="{ absent: attempt.accuracy === null }">{{ accuracy }}</dd>
			</div>
			<div>
				<dt>Hits</dt>
				<dd>{{ attempt.hits }}</dd>
			</div>
			<div>
				<dt>Shots</dt>
				<dd>{{ attempt.shots }}</dd>
			</div>
			<div>
				<dt>Sensitivity</dt>
				<dd>{{ sensitivity }}</dd>
			</div>
		</dl>

		<p v-if="!attempt.hasPerf" class="detail">
			No performance detail was imported for this attempt. The result above is complete and valid;
			only the within-run detail is unavailable.
		</p>
	</section>
</template>

<style scoped>
.summary {
	display: flex;
	flex-direction: column;
	gap: var(--space-3);
}

h1 {
	font-size: 1.5rem;
	overflow-wrap: anywhere;
}

.meta {
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-3);
	color: var(--color-text-muted);
	font-size: 0.875rem;
}

.stem {
	font-family: var(--font-mono);
	overflow-wrap: anywhere;
}

.stats {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
	gap: var(--space-3);
}

dt {
	color: var(--color-text-muted);
	font-size: 0.75rem;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

dd {
	font-family: var(--font-mono);
	font-size: 1.125rem;
}

dd.absent {
	font-family: var(--font-sans);
	font-size: 0.9375rem;
	color: var(--color-text-muted);
}

.detail {
	padding: var(--space-2) var(--space-3);
	border: 1px solid var(--color-border);
	border-radius: 6px;
	color: var(--color-text-muted);
	font-size: 0.875rem;
}
</style>
