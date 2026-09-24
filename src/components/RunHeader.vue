<script setup lang="ts">
/**
 * The result header (Run view R1): scenario and meta, the baseline, the signed
 * delta, and the result.
 *
 * Direction is uniform: positive is better in both kinds. A race's result is its
 * completion time, `budget − score`, and its delta is in seconds. Sign and arrow
 * carry direction as well as color. A null is absent, never zero.
 */
import { computed } from 'vue';
import type { Baseline } from '../lib/run/baseline';
import type { Attempt } from '../lib/run/queries';
import type { RunCurve } from '../lib/scoring';
import { formatDuration, formatScore, formatSigned, formatValue, timeFormat } from '../lib/run/format';

const props = defineProps<{
	attempt: Attempt;
	current: RunCurve | null;
	/** Null while the analysis loads. */
	baseline: Baseline | null;
}>();

const budget = computed(() => (props.current?.params.kind === 'race' ? props.current.params.budget : null));
const race = computed(() => budget.value !== null);
const digits = computed(() => (race.value ? 2 : 1));

/** A CSV score as the result it stands for. */
function result(score: number): number {
	return budget.value === null ? score : budget.value - score;
}

/** A result as shown: a race time to the hundredth, a score as recorded. */
function shownResult(score: number): string {
	return race.value ? formatValue(result(score), 2) : formatScore(score);
}

const meta = computed(() => {
	const { sensScale, horizSens, vertSens } = props.attempt;
	const sens = horizSens === vertSens ? formatValue(horizSens, 3) : `${formatValue(horizSens, 3)} / ${formatValue(vertSens, 3)}`;
	return [timeFormat.format(new Date(props.attempt.startedAt)), formatDuration(props.attempt.durationS), `${sens} ${sensScale}`];
});

const resultText = computed(() =>
	props.attempt.score === null ? null : shownResult(props.attempt.score),
);

const NONE: Record<Extract<Baseline, { kind: 'none' }>['reason'], string> = {
	'first-run': 'first run',
	'no-comparable': 'no comparable charted run',
	'is-pb': 'this is the PB',
};

const compared = computed(() => {
	const b = props.baseline;
	if (b === null) return null;
	if (b.kind === 'none') return { label: null, value: NONE[b.reason], sub: null };
	const when = timeFormat.format(new Date(b.run.startedAt));
	const sub =
		b.kind === 'flat'
			? `${when} · ${b.reason === 'no-perf' ? 'no performance detail' : 'not comparable'}`
			: when;
	return { label: b.label, value: `${shownResult(b.score)}${race.value ? ' s' : ''}`, sub };
});

const delta = computed(() => {
	const b = props.baseline;
	const score = props.attempt.score;
	if (b === null || b.kind === 'none' || score === null) return null;
	const diff = score - b.score;
	const base = result(b.score);
	const pct = base !== 0 ? (diff / Math.abs(base)) * 100 : null;
	const ahead = diff > 0;
	const even = diff === 0;
	return {
		ahead,
		even,
		pct: pct === null ? null : formatSigned(pct, 1) + '%',
		abs: `${formatSigned(diff, digits.value)} ${race.value ? 's' : 'pts'}`,
		words: even ? `level with ${b.label}` : `${ahead ? 'ahead of' : 'behind'} ${b.label}`,
	};
});
</script>

<template>
	<section class="header" aria-labelledby="run-heading">
		<div class="title">
			<h1 id="run-heading">{{ attempt.scenarioName }}</h1>
			<p class="meta">
				<template v-for="(part, i) in meta" :key="i">
					<i v-if="i > 0" aria-hidden="true"></i>
					<span>{{ part }}</span>
				</template>
			</p>
		</div>

		<div class="compared">
			<div class="label">compared with</div>
			<template v-if="compared">
				<div class="value">
					<span v-if="compared.label" class="base">{{ compared.label }}</span>
					<span :class="{ words: !compared.label }">{{ compared.value }}</span>
				</div>
				<div v-if="compared.sub" class="sub">{{ compared.sub }}</div>
			</template>
			<div v-else class="value muted">…</div>
		</div>

		<div
			class="delta"
			:class="delta ? { ahead: delta.ahead && !delta.even, behind: !delta.ahead && !delta.even } : undefined"
		>
			<template v-if="delta">
				<div class="big">
					<span class="arrow" aria-hidden="true">{{ delta.even ? '=' : delta.ahead ? '▲' : '▼' }}</span>
					<span>{{ delta.pct ?? delta.abs }}</span>
				</div>
				<div class="sub">{{ delta.words }}<template v-if="delta.pct"> · {{ delta.abs }}</template></div>
			</template>
			<div v-else class="big none" aria-hidden="true">—</div>
		</div>

		<div class="result">
			<div class="label">{{ race ? 'time' : 'score' }}</div>
			<div v-if="resultText !== null" class="value">
				{{ resultText }}<span v-if="race" class="unit"> s</span>
			</div>
			<div v-else class="value absent">No score recorded</div>
		</div>
	</section>
</template>

<style scoped>
.header {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto auto auto;
	align-items: end;
	gap: var(--space-3) 26px;
	padding-bottom: 12px;
	border-bottom: 1px solid var(--color-border);
}

h1 {
	font-weight: 500;
	font-size: 25px;
	letter-spacing: -0.015em;
	color: var(--color-text-strong);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.meta {
	margin-top: 6px;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 9px;
	font: 400 11.5px/1.2 var(--font-mono);
	color: var(--color-text-faint);
}

.meta i {
	width: 3px;
	height: 3px;
	border-radius: 50%;
	background: #79818a;
}

.label {
	font: 500 10px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.16em;
	color: var(--color-text-faint);
}

.compared {
	text-align: right;
	padding-right: 26px;
	border-right: 1px solid var(--color-border);
}

.compared .value {
	margin-top: 7px;
	display: flex;
	align-items: baseline;
	justify-content: flex-end;
	gap: 8px;
	font: 400 17px/1 var(--font-mono);
	font-variant-numeric: tabular-nums;
}

.compared .base {
	font-size: 13px;
	font-weight: 500;
	color: var(--color-baseline);
}

.compared .words {
	font-size: 13px;
	color: var(--color-text-muted);
}

.sub {
	margin-top: 6px;
	font: 400 11px/1.2 var(--font-mono);
	color: var(--color-text-faint);
}

.delta {
	text-align: right;
	color: var(--color-text-muted);
}

.delta.ahead {
	color: var(--color-ahead);
}

.delta.behind {
	color: var(--color-behind);
}

.big {
	display: flex;
	align-items: baseline;
	justify-content: flex-end;
	gap: 0.22em;
	font: 500 52px/0.92 var(--font-mono);
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.045em;
}

.big.none {
	color: var(--color-border-strong);
}

.arrow {
	font-size: 24px;
	letter-spacing: 0;
}

.delta .sub {
	margin-top: 8px;
	font-size: 12px;
	color: #a2a9b0;
}

.result {
	text-align: right;
	padding-left: 26px;
	border-left: 1px solid var(--color-border);
}

.result .value {
	margin-top: 7px;
	font: 500 36px/1 var(--font-mono);
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.025em;
	color: var(--color-text-strong);
}

.unit {
	font-size: 19px;
	color: var(--color-text-faint);
}

.result .absent {
	font: 400 13px/1.2 var(--font-sans);
	color: var(--color-text-muted);
}

.muted {
	color: var(--color-text-faint);
}

@media (max-width: 1100px) {
	.header {
		grid-template-columns: repeat(3, auto);
		justify-content: start;
	}

	.title {
		grid-column: 1 / -1;
	}

	.compared,
	.delta,
	.result {
		text-align: left;
	}

	.compared .value,
	.big {
		justify-content: flex-start;
	}
}
</style>
