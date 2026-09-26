<script setup lang="ts">
/**
 * The result header (Run view R1): scenario and meta, the baseline, the signed
 * delta, and the result. The scenario name links to its scenario page.
 *
 * Direction is uniform: positive is better in both kinds. A race's result is its
 * completion time, `budget − score`, and its delta is in seconds. Sign and arrow
 * carry direction as well as color. A null is absent, never zero.
 */
import { computed } from 'vue';
import { formatGap, inkFor } from '../lib/benchmarks/format';
import type { Candidate } from '../lib/benchmarks/pick';
import { rankOf, type RankResult } from '../lib/benchmarks/rank';
import type { Baseline } from '../lib/run/baseline';
import type { Attempt } from '../lib/run/queries';
import type { RunCurve } from '../lib/scoring';
import { formatDuration, formatScore, formatSigned, formatValue, timeFormat } from '../lib/run/format';

const props = defineProps<{
	attempt: Attempt;
	current: RunCurve | null;
	/** Null while the analysis loads. */
	baseline: Baseline | null;
	/** The benchmarks containing the scenario, default first; empty when none or not loaded. */
	candidates: readonly Candidate[];
	selected: Candidate | null;
	rank: RankResult | null;
}>();

const emit = defineEmits<{ (event: 'pick', benchmarkId: number | null): void }>();

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

/** A rank's name, or "Unranked" below the first threshold. */
function rankName(c: Candidate, k: number): string {
	return k < 0 ? 'Unranked' : c.benchmark.ranks[k]!.name;
}

function benchmarkName(c: Candidate): string {
	return `${c.benchmark.name} · ${c.benchmark.difficulty}`;
}

/** The select's value for no benchmark. */
const NO_BENCHMARK = 'none';

/** B6: the rank badge, the gap to the next rank, and the benchmark choice. */
const benchmark = computed(() => {
	if (props.candidates.length === 0) return null;
	const c = props.selected;
	const r = props.rank;
	const score = props.attempt.score;
	const options = props.candidates.map((o) => ({
		value: String(o.benchmark.id),
		text:
			benchmarkName(o) +
			(score === null ? '' : ` — ${rankName(o, rankOf(o.thresholds, score).k)}`) +
			(o.isDefault ? ' (default)' : ''),
	}));
	options.push({ value: NO_BENCHMARK, text: 'None' });
	// None picked: only the choice remains.
	if (c === null) return { value: NO_BENCHMARK, badge: null, gap: null, options };
	const color = r !== null && r.k >= 0 ? c.benchmark.ranks[r.k]!.color : null;
	const kind = props.current?.params.kind ?? null;
	// While the analysis loads, a race is not known to be one yet: its gap would
	// show in points first and switch to seconds.
	const settled = props.baseline !== null;
	return {
		value: String(c.benchmark.id),
		badge: r === null ? null : { name: rankName(c, r.k), color, ink: color === null ? null : inkFor(color) },
		gap: settled && r?.gap != null && r.nextRank !== null ? formatGap(r.gap, c.benchmark.ranks[r.nextRank]!.name, kind) : null,
		options,
	};
});

function onPick(event: Event): void {
	const value = (event.target as HTMLSelectElement).value;
	emit('pick', value === NO_BENCHMARK ? null : Number(value));
}

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
			<div class="name">
				<h1 id="run-heading">
					<RouterLink
						:to="{ name: 'scenario', params: { hash: attempt.scenarioHash } }"
						class="scenario-link"
						title="Open this scenario's page"
						>{{ attempt.scenarioName }}</RouterLink
					>
				</h1>
			</div>
			<div class="line">
				<p class="meta">
					<template v-for="(part, i) in meta" :key="i">
						<i v-if="i > 0" aria-hidden="true"></i>
						<span>{{ part }}</span>
					</template>
				</p>
				<div class="benchmark">
					<template v-if="benchmark">
						<span
							v-if="benchmark.badge"
							class="badge"
							:class="{ unranked: benchmark.badge.color === null }"
							:style="benchmark.badge.color ? { background: benchmark.badge.color, color: benchmark.badge.ink! } : undefined"
							>{{ benchmark.badge.name }}</span
						>
						<span v-if="benchmark.gap" class="gap">{{ benchmark.gap }}</span>
						<label class="chip">
							<span class="sr-only">Benchmark</span>
							<select :value="benchmark.value" @change="onPick">
								<option v-for="option in benchmark.options" :key="option.value" :value="option.value">{{ option.text }}</option>
							</select>
						</label>
					</template>
				</div>
			</div>
		</div>

		<div class="compared">
			<div class="label">compared with</div>
			<template v-if="compared">
				<div class="value">
					<span v-if="compared.label" class="base">{{ compared.label }}</span>
					<span :class="{ words: !compared.label }">{{ compared.value }}</span>
				</div>
				<div class="sub">{{ compared.sub ?? ' ' }}</div>
			</template>
			<template v-else>
				<div class="value muted">…</div>
				<div class="sub">&nbsp;</div>
			</template>
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
			<template v-else>
				<div class="big none" aria-hidden="true">—</div>
				<div class="sub">&nbsp;</div>
			</template>
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
/*
	The three figures have fixed columns and single-line text, so a run with
	wider numbers or a longer baseline note does not move anything else in the
	header when switching runs.
*/
.header {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 16rem 13.5rem 11.5rem;
	align-items: end;
	gap: var(--space-3) 26px;
	padding-bottom: 12px;
	border-bottom: 1px solid var(--color-border);
}

.name {
	min-width: 0;
}

h1 {
	min-width: 0;
	max-width: 100%;
	font-weight: 500;
	font-size: 25px;
	letter-spacing: -0.015em;
	color: var(--color-text-strong);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.scenario-link {
	color: inherit;
	text-decoration: none;
}

.scenario-link:hover,
.scenario-link:focus-visible {
	text-decoration: underline;
	text-decoration-color: var(--color-accent);
	text-underline-offset: 4px;
}

/*
	The benchmark has its own line under the meta, reserved even when the
	scenario is in no benchmark, so the header is one height for every run and
	switching runs never moves the page below it.
*/
.line {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 8px;
	margin-top: 6px;
}

.benchmark {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	max-width: 100%;
	min-height: 22px;
	line-height: 1;
	font: 400 11.5px/1.2 var(--font-mono);
	color: var(--color-text-muted);
}

.badge {
	display: inline-flex;
	align-items: center;
	height: 22px;
	padding: 0 7px;
	border-radius: 3px;
	font-weight: 600;
	letter-spacing: 0.02em;
}

.badge.unranked {
	border: 1px solid var(--color-border-strong);
	color: var(--color-text-muted);
}

.gap {
	font-variant-numeric: tabular-nums;
	color: var(--color-text);
}

.chip select {
	max-width: min(100%, 56ch);
	height: 22px;
	padding: 2px 6px;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	background: transparent;
	color: var(--color-text-muted);
	font: inherit;
	cursor: pointer;
}

.chip select:hover {
	border-color: var(--color-accent);
}

.chip option {
	background: var(--color-surface);
	color: var(--color-text);
}

.meta {
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

.compared,
.delta,
.result {
	min-width: 0;
}

.compared .value,
.sub,
.result .value {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
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
		grid-template-columns: 16rem 13.5rem 11.5rem;
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
