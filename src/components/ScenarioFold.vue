<script setup lang="ts">
/**
 * The head of a scenario's fold on the Benchmarks page: the concrete numbers
 * behind its row, then what to do next. Inspect, decide, act: play it in
 * Kovaak's, follow it live in Run, or leave for its own page.
 *
 * Follow in Run and the scenario page need a version this browser has runs
 * of; an unplayed scenario offers only Kovaak's.
 */
import { computed } from 'vue';
import type { ScenarioFacts } from '../composables/useBenchmarkPage';
import { useSelection } from '../composables/useSelection';
import { formatScore, timeFormat } from '../lib/run/format';
import { kovaaksLink } from '../lib/scenario/link';

const props = defineProps<{
	name: string;
	facts: ScenarioFacts;
	/** The version with the most runs; null when unplayed. */
	hash: string | null;
	/** This difficulty's KovaaK's benchmark ID: the scenario page opens with it selected. */
	benchmarkId: number;
	unrated: boolean;
}>();

const { latestSeen } = useSelection();

const parts = computed(() => {
	const f = props.facts;
	const out: string[] = [];
	if (f.pb !== null) out.push(`PB ${formatScore(f.pb)}`);
	if (f.next) out.push(`${f.pb === null ? 'first rank' : 'next'}: ${f.next.name} at ${formatScore(f.next.at)}${f.next.gap === null ? '' : ` (+${formatScore(f.next.gap)})`}`);
	else if (f.pb !== null && !props.unrated) out.push('top rank reached');
	if (props.unrated) out.push('no ladder on this difficulty');
	out.push(f.runs === 0 ? 'not played yet' : `${f.runs} ${f.runs === 1 ? 'run' : 'runs'}`);
	if (f.last !== null) out.push(`last ${timeFormat.format(new Date(f.last))}`);
	return out;
});

const kovaaks = computed(() => kovaaksLink(props.name));
const runTo = computed(() => (props.hash === null ? null : { path: '/', query: { scenario: props.hash } }));

/** As the scenario page's Play in Run: follow latest in a new filter, so the next run is picked up live. */
function follow(event: MouseEvent, navigate: (e?: MouseEvent) => unknown): void {
	if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) latestSeen.value = null;
	navigate(event);
}
</script>

<template>
	<div class="strip">
		<p class="facts">
			<template v-for="(part, i) in parts" :key="i">
				<i v-if="i > 0" aria-hidden="true"></i>
				<span>{{ part }}</span>
			</template>
		</p>
		<div class="actions">
			<a :href="kovaaks" class="action kovaaks" title="Opens this scenario in Kovaak’s through Steam">Play in Kovaak’s</a>
			<RouterLink v-if="runTo" v-slot="{ href, navigate }" :to="runTo" custom>
				<a :href="href" class="action" title="Open Run filtered to this scenario, following the latest run" @click="follow($event, navigate)"
					>Follow in Run</a
				>
			</RouterLink>
			<RouterLink v-if="hash" class="page" :to="{ name: 'scenario', params: { hash }, query: { bench: benchmarkId } }"
				>Scenario page →</RouterLink
			>
		</div>
	</div>
</template>

<style scoped>
.strip {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px 18px;
	padding: 0 4px 8px 12px;
}

.facts {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 9px;
	font: 400 12px/1.3 var(--font-mono);
	font-variant-numeric: tabular-nums;
	color: var(--color-text-muted);
}

.facts span:first-child {
	color: var(--color-text);
}

.facts i {
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
	padding: 5px 11px;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	color: var(--color-text);
	font: 500 11.5px/1.2 var(--font-mono);
	text-decoration: none;
	white-space: nowrap;
}

.action:hover {
	border-color: var(--color-accent);
}

/* Kovaak's own orange, as on the scenario page. */
.action.kovaaks {
	--kovaaks: #ff8a1f;
	border-color: var(--kovaaks);
	color: var(--kovaaks);
}

.action.kovaaks:hover {
	background: color-mix(in srgb, var(--kovaaks) 14%, transparent);
	color: #ffb066;
}

.page {
	margin-left: 4px;
	font: 400 11.5px/1.2 var(--font-mono);
	color: var(--color-text-muted);
	text-decoration: none;
	white-space: nowrap;
}

.page:hover {
	color: var(--color-accent);
}

.action:focus-visible,
.page:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 1px;
}
</style>
