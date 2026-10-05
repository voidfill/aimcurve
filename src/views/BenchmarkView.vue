<script setup lang="ts">
/**
 * One benchmark difficulty: where the player stands on every level of its
 * tree, how consistent they are, and how they got there.
 * See docs/superpowers/specs/2026-10-05-benchmarks-page-design.md.
 *
 * Which charts are open is page state, not persisted: the overall starts open,
 * an import keeps whatever is open, and another difficulty starts over.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BenchmarkHeader from '../components/BenchmarkHeader.vue';
import BenchmarkTable from '../components/BenchmarkTable.vue';
import { useBenchmarkPage } from '../composables/useBenchmarkPage';
import { useChartAxis, useCoverageMode, useRunWindow } from '../composables/useChartSettings';
import { useDb } from '../composables/useDb';

const route = useRoute();
const router = useRouter();
const { ready, error: dbError } = useDb();

const id = computed(() => {
	const value = route.params.id;
	return Number((Array.isArray(value) ? value[0] : value) ?? Number.NaN);
});

const mode = useCoverageMode();
const runWindow = useRunWindow();
const axis = useChartAxis();
const dateAxis = computed(() => axis.value === 'date');

const page = useBenchmarkPage(id, { mode, runWindow });
const { state, error, snapshot, benchmark, family, tree, rows, coverage } = page;

/** `?open=<row key>`: a link into the sheet at one row, which starts open instead of the overall. */
function initialOpen(): Set<string> {
	const value = route.query.open;
	const key = Array.isArray(value) ? value[0] : value;
	return new Set([typeof key === 'string' && key !== '' ? key : 'overall']);
}

const open = ref(initialOpen());
watch(id, () => (open.value = initialOpen()));

/* A linked row is brought into view once the sheet has drawn it. */
const stopReveal = watch(rows, async (list) => {
	const key = route.query.open;
	if (typeof key !== 'string' || list.length === 0) return;
	stopReveal();
	await nextTick();
	document.querySelector(`[data-row="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'start' });
});

function toggle(key: string): void {
	const next = new Set(open.value);
	if (!next.delete(key)) next.add(key);
	open.value = next;
}

async function openRun(runId: number): Promise<void> {
	const link = await page.runLink(runId);
	if (link) void router.push({ path: '/', query: { run: link.fileStem, scenario: link.hash } });
}

watch(
	benchmark,
	(b) => {
		if (b) document.title = `${b.name} ${b.difficulty} — aimcurve`;
	},
	{ immediate: true },
);
</script>

<template>
	<div class="benchmark">
		<section v-if="dbError !== null" class="notice danger" role="alert">
			<h1>This benchmark is unavailable</h1>
			<p>The local database could not be opened, so no run can be read.</p>
			<p>{{ dbError.message }}</p>
			<RouterLink :to="{ name: 'data' }">Open Data to retry</RouterLink>
		</section>

		<section v-else-if="state === 'error'" class="notice danger" role="alert">
			<h1>This benchmark could not be read</h1>
			<p>{{ error }}</p>
			<button type="button" @click="page.retry()">Try again</button>
		</section>

		<section v-else-if="snapshot !== null && (benchmark === null || tree === null)" class="notice" role="alert">
			<h1>{{ benchmark ? 'This difficulty has no category tree' : 'That benchmark is not known' }}</h1>
			<p v-if="benchmark">
				{{ benchmark.name }} {{ benchmark.difficulty }}'s categories could not be matched to its scenarios, so it has no
				custom energy. Its ladders still rank scenarios on their own pages.
			</p>
			<p v-else>
				The link points at benchmark difficulty <code>{{ route.params.id }}</code>, which is not in this version's
				benchmark list. No other benchmark has been shown in its place.
			</p>
			<div class="actions">
				<RouterLink :to="{ name: 'benchmarks' }">Go to Benchmarks</RouterLink>
			</div>
		</section>

		<p v-else-if="!ready || state === 'loading' || benchmark === null || tree === null" class="muted pending">
			{{ ready ? 'Loading benchmark…' : 'Starting the local database…' }}
		</p>

		<template v-else>
			<BenchmarkHeader
				v-model:mode="mode"
				:run-window="runWindow"
				v-model:axis="axis"
				:benchmark="benchmark"
				:family="family"
				:coverage="coverage"
			/>
			<section class="sheet" aria-label="Benchmark sheet">
				<BenchmarkTable
					:rows="rows"
					:ranks="tree.ranks"
					:open="open"
					:chart-for="page.chartFor"
					:date-axis="dateAxis"
					:run-window="runWindow"
					:benchmark-id="benchmark.id"
					@toggle="toggle"
					@open-run="openRun"
				/>
			</section>
		</template>
	</div>
</template>

<style scoped>
.benchmark {
	/* The pinned bar's height; the sheet's column legend pins right under it. */
	--bar-h: 52px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px 18px 24px;
	min-width: 0;
}

.sheet {
	min-width: 0;
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

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-3);
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
