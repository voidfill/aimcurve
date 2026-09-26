<script setup lang="ts">
/**
 * The Scenarios directory: every scenario version played in this browser,
 * searchable and sortable, each opening its scenario page.
 * See docs/superpowers/specs/2026-09-26-scenarios-directory-design.md.
 */
import { computed, useTemplateRef, watch } from 'vue';
import EmptyState from '../components/EmptyState.vue';
import ScenarioTable from '../components/ScenarioTable.vue';
import { usePbRanks } from '../composables/usePbRanks';
import { useDb } from '../composables/useDb';
import { useDirectoryRoute, useScenarioDirectory } from '../composables/useScenarioDirectory';
import { benchmarkOptions, filterRows, inBenchmark, sortRows } from '../lib/scenario/directory';

const { ready, error: dbError } = useDb();
const { state, error, rows, retry } = useScenarioDirectory();
const { current, setQ, setSort, setBench } = useDirectoryRoute();

const { snapshot, settled, bench, ranks } = usePbRanks(
	rows,
	computed(() => current.value.bench),
);

const options = computed(() => (snapshot.value ? benchmarkOptions(snapshot.value, rows.value) : []));
const benchLabel = computed(() => {
	const b = snapshot.value?.benchmarks.find((x) => x.id === bench.value);
	return b ? `${b.name} · ${b.difficulty}` : null;
});
/** A URL with a benchmark waits for the snapshot rather than flashing every row. */
const waiting = computed(() => current.value.bench !== null && !settled.value);

const pool = computed(() => (bench.value !== null && snapshot.value ? inBenchmark(rows.value, snapshot.value, bench.value) : rows.value));
const shown = computed(() =>
	sortRows(filterRows(pool.value, current.value.q), current.value.sort, current.value.dir, (r) => ranks.value.get(r.hash)?.k ?? null),
);

function onBench(event: Event): void {
	const value = (event.target as HTMLSelectElement).value;
	setBench(value === '' ? null : Number(value));
}

/* Focused on arrival: the input first renders once the rows have loaded. */
const search = useTemplateRef<HTMLInputElement>('search');
const stop = watch(search, (el) => {
	if (el === null) return;
	el.focus();
	stop();
});
</script>

<template>
	<div class="scenarios">
		<section v-if="dbError !== null" class="notice danger" role="alert">
			<h1>Scenarios are unavailable</h1>
			<p>The local database could not be opened, so no run can be read.</p>
			<p>{{ dbError.message }}</p>
			<RouterLink :to="{ name: 'data' }">Open Data to retry</RouterLink>
		</section>

		<p v-else-if="!ready || (state === 'loading' && rows.length === 0)" class="muted">
			{{ ready ? 'Loading scenarios…' : 'Starting the local database…' }}
		</p>

		<section v-else-if="state === 'error'" class="notice danger" role="alert">
			<h1>The scenarios could not be read</h1>
			<p>{{ error }}</p>
			<button type="button" @click="retry()">Try again</button>
		</section>

		<EmptyState v-else-if="rows.length === 0" />

		<section v-else class="panel" aria-labelledby="scenarios-heading">
			<header>
				<h1 id="scenarios-heading">Scenarios</h1>
				<span class="sub">{{ shown.length === rows.length ? rows.length : `${shown.length} of ${rows.length}` }}</span>
				<select class="bench" aria-label="Benchmark" :value="bench ?? ''" @change="onBench">
					<option value="">All scenarios</option>
					<optgroup v-for="group in options" :key="group.name" :label="group.name">
						<option v-for="o in group.options" :key="o.id" :value="o.id">{{ group.name }} · {{ o.label }}</option>
					</optgroup>
				</select>
				<input
					ref="search"
					type="search"
					placeholder="Search scenarios"
					aria-label="Search scenarios"
					:value="current.q"
					@input="setQ(($event.target as HTMLInputElement).value)"
				/>
			</header>
			<p v-if="waiting" class="none">Loading benchmarks…</p>
			<ScenarioTable
				v-else-if="shown.length"
				:rows="shown"
				:ranks="ranks"
				:sort="current.sort"
				:dir="current.dir"
				:bench-label="benchLabel"
				@sort="setSort"
			/>
			<p v-else class="none">
				No scenarios match '{{ current.q.trim() }}'{{ benchLabel ? ` in ${benchLabel}` : '' }}.
				<button type="button" @click="setQ('')">Clear search</button>
			</p>
		</section>
	</div>
</template>

<style scoped>
.scenarios {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px 18px 24px;
	min-width: 0;
}

.panel {
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: 3px;
	min-width: 0;
	overflow: hidden;
}

.panel header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 14px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--color-border);
}

.panel h1 {
	font: 500 11px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.15em;
	color: #c3c9cf;
}

.sub {
	font: 400 11px/1.2 var(--font-mono);
	color: var(--color-text-faint);
}

.bench {
	margin-left: auto;
	max-width: min(280px, 100%);
	background: var(--color-bg, transparent);
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	padding: 5px 8px;
	font: 400 12.5px/1.2 var(--font-mono);
	color: var(--color-text);
	cursor: pointer;
}

.bench:focus-visible {
	outline: none;
	border-color: var(--color-accent);
}

.bench option,
.bench optgroup {
	background: var(--color-surface);
}

input {
	width: min(320px, 100%);
	background: var(--color-bg, transparent);
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	padding: 5px 8px;
	font: 400 12.5px/1.2 var(--font-mono);
	color: var(--color-text);
}

input:focus-visible {
	outline: none;
	border-color: var(--color-accent);
}

.none {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
	padding: 14px 12px;
	font: 400 12px/1.4 var(--font-mono);
	color: var(--color-text-muted);
}

.notice {
	display: flex;
	flex-direction: column;
	gap: var(--space-3);
	align-items: flex-start;
	padding: var(--space-4);
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: var(--color-surface);
	max-width: 62ch;
}

.notice.danger {
	border-color: var(--color-danger);
}

.notice h1 {
	font-size: 1.25rem;
}

.muted {
	color: var(--color-text-muted);
}

button {
	background: transparent;
	border: 1px solid var(--color-border);
	border-radius: 6px;
	padding: var(--space-1) var(--space-3);
	cursor: pointer;
}

button:hover {
	border-color: var(--color-accent);
}
</style>
