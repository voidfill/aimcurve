<script setup lang="ts">
/**
 * The scenario page header (S3 of the scenario page design): name, short hash
 * and version switcher, the benchmark picker, a meta line, then Play in Run
 * and Open in Kovaak's.
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Candidate } from '../lib/benchmarks/pick';
import { formatValue, timeFormat } from '../lib/run/format';
import { formatPlayed } from '../lib/scenario/format';
import { isNewestVersion, kovaaksLink, type ScenarioVersion, shortHash, versionLabel } from '../lib/scenario/link';
import type { Scenario } from '../lib/scenario/queries';
import { useSelection } from '../composables/useSelection';
import BenchmarkPicker from './BenchmarkPicker.vue';
import RunWindowSelect from './RunWindowSelect.vue';

const props = defineProps<{
	scenario: Scenario;
	versions: readonly ScenarioVersion[];
	runs: number;
	playedS: number;
	lastPlayed: string;
	pbScore: number | null;
	candidates: readonly Candidate[];
	selected: Candidate | null;
}>();

const emit = defineEmits<{ (event: 'pick', benchmarkId: number | null): void }>();

const router = useRouter();
const route = useRoute();

const meta = computed(() => [
	`${formatValue(props.runs)} completed ${props.runs === 1 ? 'run' : 'runs'}`,
	`${formatPlayed(props.playedS)} played`,
	`last ${timeFormat.format(new Date(props.lastPlayed))}`,
]);

const playTo = computed(() => ({ path: '/', query: { scenario: props.scenario.hash } }));

const { followLatest } = useSelection();

const kovaaks = computed(() => kovaaksLink(props.scenario.name));
const kovaaksTitle = computed(() =>
	isNewestVersion(props.scenario.hash, props.versions)
		? 'Opens this scenario in Kovaak’s through Steam'
		: 'Kovaak’s opens scenarios by name: it will open whatever it has under this name now, which may not be this older version',
);

function onVersion(event: Event): void {
	const hash = (event.target as HTMLSelectElement).value;
	// Another version of the same scenario keeps the benchmark a sheet linked with.
	const bench = route.query.bench;
	if (hash !== props.scenario.hash) void router.push({ name: 'scenario', params: { hash }, query: bench ? { bench } : {} });
}

</script>

<template>
	<section class="header" aria-labelledby="scenario-heading">
		<div class="title">
			<div class="name">
				<h1 id="scenario-heading">{{ scenario.name }}</h1>
				<span v-if="versions.length <= 1" class="hash" :title="scenario.hash">{{ shortHash(scenario.hash) }}</span>
				<label v-else class="chip">
					<span class="sr-only">Scenario version</span>
					<select :value="scenario.hash" @change="onVersion">
						<option v-for="v in versions" :key="v.hash" :value="v.hash">{{ versionLabel(v) }}</option>
					</select>
				</label>
				<div v-if="candidates.length > 0" class="benchmark">
					<BenchmarkPicker :candidates="candidates" :selected="selected" :score="pbScore" @pick="emit('pick', $event)" />
				</div>
			</div>
			<p class="meta">
				<template v-for="(part, i) in meta" :key="i">
					<i v-if="i > 0" aria-hidden="true"></i>
					<span>{{ part }}</span>
				</template>
			</p>
		</div>
		<div class="actions">
			<RunWindowSelect />
			<RouterLink v-slot="{ href, navigate }" :to="playTo" custom>
				<a :href="href" class="action primary" @click="followLatest($event, navigate)">Play in Run</a>
			</RouterLink>
			<a :href="kovaaks" class="action kovaaks" :title="kovaaksTitle">Open in Kovaak’s</a>
		</div>
	</section>
</template>

<style scoped>
.header {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	justify-content: space-between;
	gap: var(--space-3) 26px;
	padding-bottom: 12px;
	border-bottom: 1px solid var(--color-border);
}

.title {
	min-width: 0;
	flex: 1 1 420px;
}

.name {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 14px;
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

.hash {
	font: 400 11.5px/1 var(--font-mono);
	color: var(--color-text-faint);
}

.benchmark {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	font: 400 11.5px/1.2 var(--font-mono);
	color: var(--color-text-muted);
}

.chip select {
	max-width: min(100%, 56ch);
	padding: 2px 6px;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	background: transparent;
	color: var(--color-text-muted);
	font: 400 11.5px/1.2 var(--font-mono);
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

.actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.action {
	padding: 6px 12px;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	color: var(--color-text);
	font: 500 12px/1.2 var(--font-mono);
	text-decoration: none;
	white-space: nowrap;
}

.action:hover {
	border-color: var(--color-accent);
}

.action.primary {
	border-color: var(--color-accent);
	color: var(--color-text-strong);
}

.action.primary:hover {
	background: color-mix(in srgb, var(--color-accent) 14%, transparent);
}

/* Kovaak's own orange, so the way out to the game reads as the game's. */
.action.kovaaks {
	--kovaaks: #ff8a1f;
	border-color: var(--kovaaks);
	color: var(--kovaaks);
}

.action.kovaaks:hover {
	background: color-mix(in srgb, var(--kovaaks) 14%, transparent);
	color: #ffb066;
}
</style>
