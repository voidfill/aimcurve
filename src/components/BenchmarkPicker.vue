<script setup lang="ts">
/**
 * Which benchmark a scenario is shown against (B4, B6 of the benchmark ranks
 * design), joined to the way to that benchmark's sheet: a select and an arrow
 * as one control. Shared by the Run and scenario pages.
 *
 * Each option names the rank `score` reaches on it, short enough that the
 * select rarely needs squeezing; the default candidate comes first. The arrow
 * opens the
 * selected difficulty's sheet; with no benchmark picked, or one without a
 * sheet, it is left out.
 */
import { computed } from 'vue';
import type { Candidate } from '../lib/benchmarks/pick';
import { rankOf } from '../lib/benchmarks/rank';

const props = defineProps<{
	candidates: readonly Candidate[];
	selected: Candidate | null;
	/** The score each option names its rank for; null for none. */
	score: number | null;
}>();

const emit = defineEmits<{ (event: 'pick', benchmarkId: number | null): void }>();

/** The select's value for no benchmark. */
const NONE = 'none';

const options = computed(() => [
	...props.candidates.map((c) => {
		const k = props.score === null ? null : rankOf(c.thresholds, props.score).k;
		const rank = k === null ? '' : ` — ${k < 0 ? 'Unranked' : c.benchmark.ranks[k]!.name}`;
		return {
			value: String(c.benchmark.id),
			text: `${c.benchmark.name} · ${c.benchmark.difficulty}${rank}`,
		};
	}),
	{ value: NONE, text: 'None' },
]);

const value = computed(() => (props.selected === null ? NONE : String(props.selected.benchmark.id)));

const sheet = computed(() => {
	const b = props.selected?.benchmark;
	return b && b.tree !== null ? { name: 'benchmark', params: { id: b.id } } : null;
});

function onChange(event: Event): void {
	const v = (event.target as HTMLSelectElement).value;
	emit('pick', v === NONE ? null : Number(v));
}
</script>

<template>
	<div class="picker" :class="{ joined: sheet !== null }">
		<select :value="value" aria-label="Benchmark" @change="onChange">
			<option v-for="o in options" :key="o.value" :value="o.value">{{ o.text }}</option>
		</select>
		<RouterLink
			v-if="sheet"
			class="go"
			:to="sheet"
			:title="`Open the ${selected!.benchmark.name} · ${selected!.benchmark.difficulty} sheet`"
			:aria-label="`Open the ${selected!.benchmark.name} · ${selected!.benchmark.difficulty} benchmark sheet`"
			>→</RouterLink
		>
	</div>
</template>

<style scoped>
/* One unbreakable control: the select shrinks, the arrow never leaves its side. */
.picker {
	display: inline-flex;
	flex-wrap: nowrap;
	min-width: 0;
	max-width: 100%;
}

select {
	flex: 0 1 auto;
	min-width: 6ch;
	max-width: min(100%, 56ch);
	height: 22px;
	padding: 2px 6px;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	background: transparent;
	color: var(--color-text-muted);
	font: 400 11.5px/1.2 var(--font-mono);
	text-overflow: ellipsis;
	cursor: pointer;
}

/* Joined: the select's right edge is the arrow's left. */
.joined select {
	border-top-right-radius: 0;
	border-bottom-right-radius: 0;
}

.go {
	flex: none;
	display: flex;
	align-items: center;
	height: 22px;
	padding: 0 8px;
	margin-left: -1px;
	border: 1px solid var(--color-border-strong);
	border-radius: 0 3px 3px 0;
	color: var(--color-text-muted);
	font: 400 12px/1 var(--font-mono);
	text-decoration: none;
}

select:hover,
.go:hover {
	position: relative;
	border-color: var(--color-accent);
	color: var(--color-text);
}

select:focus-visible,
.go:focus-visible {
	position: relative;
	outline: none;
	border-color: var(--color-accent);
}

option {
	background: var(--color-surface);
	color: var(--color-text);
}
</style>
