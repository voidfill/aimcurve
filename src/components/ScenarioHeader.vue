<script setup lang="ts">
/**
 * The scenario page header (S3 of the scenario page design): name, short hash
 * and version switcher, the PB's benchmark rank, a meta line, then Play in Run
 * and Open in Kovaak's.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { formatGap, inkFor } from '../lib/benchmarks/format';
import type { Candidate } from '../lib/benchmarks/pick';
import { rankOf, type RankResult } from '../lib/benchmarks/rank';
import { formatValue, timeFormat } from '../lib/run/format';
import { formatPlayed, type ResultKind } from '../lib/scenario/format';
import { isNewestVersion, kovaaksLink, type ScenarioVersion, shortHash, versionLabel } from '../lib/scenario/link';
import type { Scenario } from '../lib/scenario/queries';
import { RUN_WINDOWS, useRunWindow } from '../composables/useChartSettings';
import { useSelection } from '../composables/useSelection';

const props = defineProps<{
	scenario: Scenario;
	versions: readonly ScenarioVersion[];
	runs: number;
	playedS: number;
	lastPlayed: string;
	kind: ResultKind;
	pbScore: number | null;
	candidates: readonly Candidate[];
	selected: Candidate | null;
	/** The PB's rank in the selected benchmark. */
	rank: RankResult | null;
}>();

const emit = defineEmits<{ (event: 'pick', benchmarkId: number | null): void }>();

const router = useRouter();
const { latestSeen } = useSelection();
const runWindow = useRunWindow();

const meta = computed(() => [
	`${formatValue(props.runs)} completed ${props.runs === 1 ? 'run' : 'runs'}`,
	`${formatPlayed(props.playedS)} played`,
	`last ${timeFormat.format(new Date(props.lastPlayed))}`,
]);

const playTo = computed(() => ({ path: '/', query: { scenario: props.scenario.hash } }));

/** Play in Run follows latest in a new filter, so the newest run is re-baselined. */
function play(event: MouseEvent, navigate: (e?: MouseEvent) => unknown): void {
	if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) latestSeen.value = null;
	navigate(event);
}

const kovaaks = computed(() => kovaaksLink(props.scenario.name));
const kovaaksTitle = computed(() =>
	isNewestVersion(props.scenario.hash, props.versions)
		? 'Opens this scenario in Kovaak’s through Steam'
		: 'Kovaak’s opens scenarios by name: it will open whatever it has under this name now, which may not be this older version',
);

function onVersion(event: Event): void {
	const hash = (event.target as HTMLSelectElement).value;
	if (hash !== props.scenario.hash) void router.push({ name: 'scenario', params: { hash } });
}

const NO_BENCHMARK = 'none';

function rankName(c: Candidate, k: number): string {
	return k < 0 ? 'Unranked' : c.benchmark.ranks[k]!.name;
}

/** B6's badge, gap and choice, for the PB. */
const benchmark = computed(() => {
	if (props.candidates.length === 0) return null;
	const c = props.selected;
	const r = props.rank;
	const score = props.pbScore;
	const options = props.candidates.map((o) => ({
		value: String(o.benchmark.id),
		text:
			`${o.benchmark.name} · ${o.benchmark.difficulty}` +
			(score === null ? '' : ` — ${rankName(o, rankOf(o.thresholds, score).k)}`) +
			(o.isDefault ? ' (default)' : ''),
	}));
	options.push({ value: NO_BENCHMARK, text: 'None' });
	if (c === null) return { value: NO_BENCHMARK, badge: null, gap: null, options };
	const color = r !== null && r.k >= 0 ? c.benchmark.ranks[r.k]!.color : null;
	const kind = props.kind.kind === 'unknown' ? null : props.kind.kind;
	return {
		value: String(c.benchmark.id),
		badge: r === null ? null : { name: rankName(c, r.k), color, ink: color === null ? null : inkFor(color) },
		gap: r?.gap != null && r.nextRank !== null ? formatGap(r.gap, c.benchmark.ranks[r.nextRank]!.name, kind) : null,
		options,
	};
});

function onPick(event: Event): void {
	const value = (event.target as HTMLSelectElement).value;
	emit('pick', value === NO_BENCHMARK ? null : Number(value));
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
				<div v-if="benchmark" class="benchmark">
					<span class="pb-label">PB</span>
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
			<label class="setting" title="Form, the chart's typical line, is the median of this many latest runs. Shared with the Benchmarks page.">
				<span>runs</span>
				<select :value="runWindow" @change="runWindow = Number(($event.target as HTMLSelectElement).value)">
					<option v-for="n in RUN_WINDOWS" :key="n" :value="n">last {{ n }}</option>
				</select>
			</label>
			<RouterLink v-slot="{ href, navigate }" :to="playTo" custom>
				<a :href="href" class="action primary" @click="play($event, navigate)">Play in Run</a>
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

.pb-label {
	font: 500 10px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.16em;
	color: var(--color-text-faint);
}

.badge {
	padding: 3px 7px;
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

.setting {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-right: 6px;
	font: 500 10px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.14em;
	color: var(--color-text-faint);
}

.setting select {
	padding: 4px 6px;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	background: transparent;
	color: var(--color-text-muted);
	font: 400 11.5px/1.2 var(--font-mono);
	letter-spacing: 0;
	text-transform: none;
	cursor: pointer;
}

.setting select:hover {
	border-color: var(--color-accent);
}

.setting option {
	background: var(--color-surface);
	color: var(--color-text);
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
