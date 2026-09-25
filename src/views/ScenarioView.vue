<script setup lang="ts">
/**
 * The scenario page: one scenario version's progression, configs, PB and
 * recent runs. See docs/superpowers/specs/2026-09-25-scenario-page-design.md.
 *
 * The version is the route's `hash`; nothing is merged by name. Every link
 * into Run inspects a run with the rail filtered to this scenario.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ConfigTable from '../components/ConfigTable.vue';
import PbCard from '../components/PbCard.vue';
import ProgressPanel from '../components/ProgressPanel.vue';
import RecentRuns from '../components/RecentRuns.vue';
import ScenarioHeader from '../components/ScenarioHeader.vue';
import { useBenchmarkRank } from '../composables/useBenchmarkRank';
import { useDb } from '../composables/useDb';
import { useScenario } from '../composables/useScenario';
import { rankOf } from '../lib/benchmarks/rank';
import { shortHash } from '../lib/scenario/link';
import type { HistoryRun } from '../lib/scenario/queries';

const route = useRoute();
const router = useRouter();
const { ready, error: dbError } = useDb();

const hash = computed(() => {
	const value = route.params.hash;
	return (Array.isArray(value) ? value[0] : value) ?? '';
});

const { state, error, data, botState, botError, bots, loadBots, retry } = useScenario(hash);

/** The best completed run; a tie goes to the earlier one. */
const pb = computed<HistoryRun | null>(() => {
	let best: HistoryRun | null = null;
	for (const run of data.value?.runs ?? []) if (run.score !== null && (best === null || run.score > best.score!)) best = run;
	return best;
});

const runsSincePb = computed(() => {
	const runs = data.value?.runs ?? [];
	const at = pb.value === null ? -1 : runs.indexOf(pb.value);
	return at < 0 ? 0 : runs.length - 1 - at;
});

const bench = useBenchmarkRank(
	computed(() => data.value?.scenario.name ?? null),
	computed(() => pb.value?.score ?? null),
);

function rankFor(score: number): { name: string; color: string | null } | null {
	const c = bench.selected.value;
	if (c === null) return null;
	const k = rankOf(c.thresholds, score).k;
	return k < 0 ? { name: 'Unranked', color: null } : { name: c.benchmark.ranks[k]!.name, color: c.benchmark.ranks[k]!.color };
}

const pbRank = computed(() => (pb.value?.score == null ? null : rankFor(pb.value.score)));

function linkTo(run: HistoryRun) {
	return { path: '/', query: { run: run.fileStem, scenario: hash.value } };
}

function open(run: HistoryRun): void {
	void router.push(linkTo(run));
}

const playedS = computed(() => (data.value?.runs ?? []).reduce((sum, r) => sum + r.durationS, 0));

/* Config highlight: hover wins over the pinned row. */
const hovered = ref<number | null>(null);
const pinned = ref<number | null>(null);
watch(hash, () => {
	hovered.value = null;
	pinned.value = null;
});
const group = computed(() => hovered.value ?? pinned.value);

watch(
	() => data.value?.scenario.name,
	(name) => {
		if (name) document.title = `${name} — aimcurve`;
	},
	{ immediate: true },
);
</script>

<template>
	<div class="scenario">
		<section v-if="dbError !== null" class="notice danger" role="alert">
			<h1>This scenario is unavailable</h1>
			<p>The local database could not be opened, so no run can be read.</p>
			<p>{{ dbError.message }}</p>
			<RouterLink :to="{ name: 'data' }">Open Data to retry</RouterLink>
		</section>

		<p v-else-if="!ready || (state === 'loading' && data === null)" class="muted">
			{{ ready ? 'Loading scenario…' : 'Starting the local database…' }}
		</p>

		<section v-else-if="state === 'error'" class="notice danger" role="alert">
			<h1>This scenario could not be read</h1>
			<p>{{ error }}</p>
			<button type="button" @click="retry()">Try again</button>
		</section>

		<section v-else-if="state === 'missing'" class="notice" role="alert">
			<h1>That scenario is not in this browser</h1>
			<p>
				The link points at scenario version <code>{{ shortHash(hash) }}</code>, which has no completed runs in this
				browser's database. It may have been imported in a different browser or profile, or removed by a database
				reset. No other scenario has been shown in its place.
			</p>
			<div class="actions">
				<RouterLink :to="{ name: 'run' }">Go to Run</RouterLink>
				<RouterLink :to="{ name: 'data' }">Import files</RouterLink>
			</div>
		</section>

		<template v-else-if="data">
			<ScenarioHeader
				:scenario="data.scenario"
				:versions="data.versions"
				:runs="data.runs.length"
				:played-s="playedS"
				:last-played="data.runs[data.runs.length - 1]!.startedAt"
				:kind="data.kind"
				:pb-score="pb?.score ?? null"
				:candidates="bench.candidates.value"
				:selected="bench.selected.value"
				:rank="bench.rank.value"
				@pick="bench.setPick"
			/>

			<ProgressPanel
				:data="data"
				:bots="bots"
				:bot-state="botState"
				:bot-error="botError"
				:bench="bench.selected.value"
				:group="group"
				@load-bots="loadBots()"
				@open="open"
			/>

			<div class="pair">
				<ConfigTable
					:groups="data.groups"
					:kind="data.kind"
					:active="hovered"
					:pinned="pinned"
					@hover="hovered = $event"
					@toggle="pinned = pinned === $event ? null : $event"
				/>
				<PbCard :pb="pb" :runs-since="runsSincePb" :kind="data.kind" :rank="pbRank" :to="pb ? linkTo(pb) : null" />
			</div>

			<RecentRuns
				:runs="data.runs"
				:group-of="data.groupOf"
				:groups="data.groups"
				:kind="data.kind"
				:rank-of="rankFor"
				:link-to="linkTo"
			/>
		</template>
	</div>
</template>

<style scoped>
.scenario {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px 18px 24px;
	min-width: 0;
}

.pair {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
	gap: 10px;
	align-items: start;
}

@media (max-width: 799px) {
	.pair {
		grid-template-columns: minmax(0, 1fr);
	}
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
