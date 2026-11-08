<script setup lang="ts">
/**
 * The Benchmarks index's table (docs/benchmarks.md), in the Scenarios table's
 * style: a section row per panel ("Your benchmarks", "Not started"), then one
 * group per family.
 *
 * A family with one difficulty is that difficulty's row. A family with more is
 * a header row (a disclosure button, the name, how many difficulties, and a
 * square per difficulty in the colour of its PB's rank) over a row per
 * difficulty, hung off a guide line. A difficulty row opens its sheet; a
 * scenario a search found is listed under its name.
 */
import { useRouter } from 'vue-router';
import type { DifficultyMatch, FamilyMatch, IndexDifficulty } from '../lib/benchmarks/catalog';
import { chartColor } from '../lib/benchmarks/format';
import { UNRANKED } from '../lib/arc/axis';
import { arcText, describeRank, rankName } from '../lib/arc/name';
import { pill } from '../lib/arc/pill';
import { timeFormat } from '../lib/run/format';
import MarkedText from './MarkedText.vue';

export interface IndexSection {
	key: 'mine' | 'rest';
	title: string;
	matches: FamilyMatch[];
}

const props = defineProps<{
	sections: readonly IndexSection[];
	q: string;
	isOpen: (m: FamilyMatch, mine: boolean) => boolean;
	now: number;
}>();

const emit = defineEmits<{ toggle: [m: FamilyMatch, mine: boolean] }>();

const router = useRouter();

/** How many scenarios a search lists under a difficulty before "+N more". */
const VIA_SHOWN = 2;

const sheet = (d: IndexDifficulty) => ({ name: 'benchmark', params: { id: d.benchmark.id } });

function open(d: IndexDifficulty, event: Event): void {
	// A click on the link itself is the link's to handle.
	if (event.target instanceof Element && event.target.closest('a')) return;
	void router.push(sheet(d));
}

function rankOf(d: IndexDifficulty) {
	if (d.r === null) return null;
	const p = pill(d.r, d.benchmark.ranks);
	return { ...p, title: `${arcText(d.r)} arc · ${describeRank(d.r, d.benchmark.ranks)}` };
}

function squareColor(d: IndexDifficulty): string | null {
	if (d.played === 0) return null;
	const c = d.r === null ? null : rankName(d.r, d.benchmark.ranks).color;
	return c === null ? UNRANKED : chartColor(c);
}

function squareTitle(d: IndexDifficulty): string {
	if (d.played === 0) return `${d.benchmark.difficulty}: not played`;
	const rank = d.r === null ? 'unrated' : describeRank(d.r, d.benchmark.ranks);
	return `${d.benchmark.difficulty}: ${rank} · ${d.played}/${d.total} played`;
}

function started(m: FamilyMatch): number {
	return m.family.difficulties.filter((d) => d.played > 0).length;
}

/** `today`, `yesterday`, `5 d ago`, `4 mo ago`, `2 y ago`. */
function age(t: number): string {
	const days = Math.floor((props.now - t) / 86_400_000);
	if (days < 1) return 'today';
	if (days < 2) return 'yesterday';
	if (days < 60) return `${days} d ago`;
	if (days < 365) return `${Math.round(days / 30.44)} mo ago`;
	return `${Math.floor(days / 365)} y ago`;
}

function moreTitle(dm: DifficultyMatch): string {
	return dm.via.slice(VIA_SHOWN).join('\n');
}
</script>

<template>
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col" class="left">benchmark</th>
					<th scope="col" class="left" title="Your PB rank on the difficulty, as ARC: not an official rank">PB rank</th>
					<th scope="col" title="Rated scenarios played, of all">played</th>
					<th scope="col">last played</th>
				</tr>
			</thead>
			<template v-for="s in sections" :key="s.key">
				<tbody class="section">
					<tr>
						<th scope="colgroup" colspan="4" class="left">
							{{ s.title }}<span class="count">{{ s.matches.length }}</span>
						</th>
					</tr>
				</tbody>
				<tbody
					v-for="m in s.matches"
					:key="m.family.name"
					class="family"
					:class="{ open: m.family.difficulties.length > 1 && isOpen(m, s.key === 'mine') }"
				>
					<!-- One difficulty: the family is its row. -->
					<tr
						v-if="m.family.difficulties.length === 1"
						class="link"
						tabindex="0"
						@click="open(m.difficulties[0]!.difficulty, $event)"
						@keydown.enter.self="open(m.difficulties[0]!.difficulty, $event)"
					>
						<th scope="row" class="left name">
							<div class="main">
								<span class="disc-space" aria-hidden="true" />
								<RouterLink class="fam" :to="sheet(m.difficulties[0]!.difficulty)" tabindex="-1"
									><MarkedText :text="m.family.name" :q="q"
								/></RouterLink>
								<span class="tag"><MarkedText :text="m.difficulties[0]!.difficulty.benchmark.difficulty" :q="q" /></span>
							</div>
							<div v-if="m.difficulties[0]!.via.length" class="via single">
								<template v-for="v in m.difficulties[0]!.via.slice(0, VIA_SHOWN)" :key="v"
									><span class="scen"><MarkedText :text="v" :q="q" /></span
								></template>
								<span v-if="m.difficulties[0]!.via.length > VIA_SHOWN" class="more" :title="moreTitle(m.difficulties[0]!)"
									>+{{ m.difficulties[0]!.via.length - VIA_SHOWN }} more</span
								>
							</div>
						</th>
						<td class="left">
							<template v-for="d in [m.difficulties[0]!.difficulty]" :key="d.benchmark.id">
								<span v-if="rankOf(d)" class="rank" :title="rankOf(d)!.title">
									<i class="sq" :style="{ background: rankOf(d)!.tint }" aria-hidden="true" />
									<span class="rname">{{ rankOf(d)!.name }}</span>
									<span class="meter" aria-hidden="true"
										><span :style="{ width: `${rankOf(d)!.fill * 100}%`, background: rankOf(d)!.tint }"
									/></span>
									<span class="pct">{{ rankOf(d)!.text }}</span>
								</span>
								<span v-else class="dim">{{ d.played > 0 ? 'unrated' : '—' }}</span>
							</template>
						</td>
						<td :class="{ strong: m.family.difficulties[0]!.played === m.family.difficulties[0]!.total, dim: m.family.difficulties[0]!.played === 0 }">
							{{ m.family.difficulties[0]!.played > 0 ? `${m.family.difficulties[0]!.played}/${m.family.difficulties[0]!.total}` : '—' }}
						</td>
						<td class="dim" :title="m.family.last !== null ? timeFormat.format(m.family.last) : undefined">
							{{ m.family.last !== null ? age(m.family.last) : '' }}
						</td>
					</tr>

					<!-- More: a header row that folds its difficulties. -->
					<template v-else>
						<tr class="head" @click="emit('toggle', m, s.key === 'mine')">
							<th scope="row" class="left name">
								<div class="main">
									<button
										type="button"
										class="disc"
										:aria-expanded="isOpen(m, s.key === 'mine')"
										:aria-label="`${isOpen(m, s.key === 'mine') ? 'Hide' : 'Show'} the ${m.family.name} difficulties`"
										@click.stop="emit('toggle', m, s.key === 'mine')"
									>
										<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 L6.5 5 L3.5 8" /></svg>
									</button>
									<span class="fam"><MarkedText :text="m.family.name" :q="q" /></span>
									<span class="tag">
										{{ m.family.difficulties.length }} difficulties<template v-if="started(m) > 0"> · {{ started(m) }} played</template
										><template v-if="m.difficulties.length < m.family.difficulties.length">
											· {{ m.difficulties.length }} match</template
										>
									</span>
								</div>
							</th>
							<td class="left">
								<span class="squares">
									<i
										v-for="d in m.family.difficulties"
										:key="d.benchmark.id"
										class="sq"
										:class="{ empty: d.played === 0 }"
										:style="squareColor(d) ? { background: squareColor(d)! } : undefined"
										:title="squareTitle(d)"
									/>
								</span>
							</td>
							<td />
							<td class="dim" :title="m.family.last !== null ? timeFormat.format(m.family.last) : undefined">
								{{ m.family.last !== null ? age(m.family.last) : '' }}
							</td>
						</tr>
						<template v-if="isOpen(m, s.key === 'mine')">
							<tr
								v-for="(dm, i) in m.difficulties"
								:key="dm.difficulty.benchmark.id"
								class="link child"
								:class="{ last: i === m.difficulties.length - 1, unplayed: dm.difficulty.played === 0 }"
								tabindex="0"
								@click="open(dm.difficulty, $event)"
								@keydown.enter.self="open(dm.difficulty, $event)"
							>
								<th scope="row" class="left name">
									<div class="main">
										<RouterLink class="diff" :to="sheet(dm.difficulty)" tabindex="-1"
											><MarkedText :text="dm.difficulty.benchmark.difficulty" :q="q"
										/></RouterLink>
									</div>
									<div v-if="dm.via.length" class="via">
										<template v-for="v in dm.via.slice(0, VIA_SHOWN)" :key="v"
											><span class="scen"><MarkedText :text="v" :q="q" /></span
										></template>
										<span v-if="dm.via.length > VIA_SHOWN" class="more" :title="moreTitle(dm)">+{{ dm.via.length - VIA_SHOWN }} more</span>
									</div>
								</th>
								<td class="left">
									<span v-if="rankOf(dm.difficulty)" class="rank" :title="rankOf(dm.difficulty)!.title">
										<i class="sq" :style="{ background: rankOf(dm.difficulty)!.tint }" aria-hidden="true" />
										<span class="rname">{{ rankOf(dm.difficulty)!.name }}</span>
										<span class="meter" aria-hidden="true"
											><span :style="{ width: `${rankOf(dm.difficulty)!.fill * 100}%`, background: rankOf(dm.difficulty)!.tint }"
										/></span>
										<span class="pct">{{ rankOf(dm.difficulty)!.text }}</span>
									</span>
									<span v-else class="dim">{{ dm.difficulty.played > 0 ? 'unrated' : '—' }}</span>
								</td>
								<td :class="{ strong: dm.difficulty.played === dm.difficulty.total, dim: dm.difficulty.played === 0 }">
									{{ dm.difficulty.played > 0 ? `${dm.difficulty.played}/${dm.difficulty.total}` : '—' }}
								</td>
								<td class="dim" :title="dm.difficulty.last !== null ? timeFormat.format(dm.difficulty.last) : undefined">
									{{ dm.difficulty.last !== null ? age(dm.difficulty.last) : '' }}
								</td>
							</tr>
						</template>
					</template>
				</tbody>
			</template>
		</table>
	</div>
</template>

<style scoped>
.scroll {
	overflow: auto;
	scrollbar-gutter: stable;
}

table {
	width: 100%;
	border-collapse: collapse;
}

/* Pinned while the body scrolls; the rule under it is a shadow because a sticky cell's border scrolls away. */
thead th {
	position: sticky;
	top: 0;
	z-index: 2;
	background: var(--color-surface);
	box-shadow: inset 0 -1px 0 var(--color-border);
	padding: 6px 12px 7px;
	font: 400 9.5px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.13em;
	color: var(--color-text-faint);
	text-align: right;
	white-space: nowrap;
}

.left,
thead .left {
	text-align: left;
}

tbody th,
td {
	padding: 6px 12px;
	border-bottom: 1px solid var(--color-rule-faint);
	font: 400 12.5px/1.2 var(--font-mono);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
	text-align: right;
	color: var(--color-text);
	vertical-align: middle;
}

tbody th {
	font-weight: 400;
}

td.left {
	text-align: left;
}

/* The panels: a band, set like the column headings. */
.section th {
	padding: 16px 12px 7px;
	background: var(--color-surface);
	border-bottom: 1px solid var(--color-border);
	font: 500 9.5px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.13em;
	color: #c3c9cf;
}

.section:first-of-type th {
	padding-top: 10px;
}

.count {
	margin-left: 8px;
	color: var(--color-text-faint);
	letter-spacing: 0.05em;
}

tr.link,
tr.head {
	cursor: pointer;
}

tr.link:hover,
tr.head:hover {
	background: #141920;
}

tr.link:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: -2px;
}

/* An open family sits on the plot colour, so its rows read as one group. */
.family.open {
	background: var(--color-plot);
}

.family.open tr.head th,
.family.open tr.head td {
	border-bottom-color: transparent;
}

.name {
	position: relative;
	max-width: 52ch;
	overflow: hidden;
	text-overflow: ellipsis;
}

.main {
	display: flex;
	align-items: center;
	gap: 9px;
	min-width: 0;
}

a {
	color: inherit;
	text-decoration: none;
}

tr.link:hover a,
tr.link:focus-visible a {
	color: var(--color-accent);
	text-decoration: underline;
}

.fam {
	color: var(--color-text-strong);
	overflow: hidden;
	text-overflow: ellipsis;
}

.tag {
	flex: none;
	font-size: 10.5px;
	color: var(--color-text-faint);
}

/* The disclosure: a real button, boxed so it reads as one, turning when open. */
.disc,
.disc-space {
	flex: none;
	width: 18px;
	height: 18px;
}

.disc {
	display: grid;
	place-items: center;
	padding: 0;
	border: 1px solid var(--color-border-strong);
	border-radius: 3px;
	background: var(--color-bg);
	color: var(--color-text-muted);
	cursor: pointer;
}

.disc svg {
	width: 10px;
	height: 10px;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.5;
	stroke-linecap: round;
	stroke-linejoin: round;
	transition: transform 120ms ease;
}

.disc[aria-expanded='true'] svg {
	transform: rotate(90deg);
}

tr.head:hover .disc,
.disc:focus-visible {
	border-color: var(--color-accent);
	color: var(--color-text);
	outline: none;
}

/* A difficulty hangs off a guide line from its family's disclosure. */
.child .name {
	padding-left: 39px;
}

.child .name::before,
.child .name::after {
	content: '';
	position: absolute;
	left: 20.5px;
	border-color: var(--color-border-strong);
	border-style: solid;
	border-width: 0;
}

.child .name::before {
	top: 0;
	bottom: 0;
	border-left-width: 1px;
}

.child.last .name::before {
	bottom: calc(100% - 15px);
}

.child .name::after {
	top: 15px;
	width: 10px;
	border-top-width: 1px;
}

.child.unplayed .diff {
	color: var(--color-text-muted);
}

/* A search's scenario matches, under the name they belong to. */
.via {
	display: flex;
	flex-wrap: wrap;
	gap: 3px 6px;
	margin-top: 5px;
	font-size: 11px;
}

.via.single {
	padding-left: 27px;
}

.scen {
	padding: 2px 6px;
	border: 1px solid var(--color-border);
	border-radius: 3px;
	color: var(--color-text-muted);
}

.more {
	align-self: center;
	color: var(--color-text-faint);
}

/* A rank: its colour, name, progress to the next rank, in fixed columns so ranks line up down the table. */
.rank {
	display: inline-grid;
	grid-template-columns: 8px 13ch 64px 4ch;
	align-items: center;
	gap: 8px;
}

.sq {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 2px;
}

.sq.empty {
	box-shadow: inset 0 0 0 1px var(--color-border-strong);
}

.rname {
	overflow: hidden;
	text-overflow: ellipsis;
}

.meter {
	height: 4px;
	border-radius: 2px;
	background: var(--color-border);
	overflow: hidden;
}

.meter > span {
	display: block;
	height: 100%;
}

.pct {
	text-align: right;
	color: var(--color-text-muted);
}

.squares {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 3px;
	max-width: 160px;
	vertical-align: middle;
}

.strong {
	color: var(--color-text-strong);
}

.dim {
	color: #a2a9b0;
}

td.dim:empty {
	color: transparent;
}

@media (max-width: 640px) {
	tbody th,
	td,
	thead th {
		padding-left: 8px;
		padding-right: 8px;
	}

	.rank {
		grid-template-columns: 8px 10ch 4ch;
	}

	.meter {
		display: none;
	}

	/* Names wrap so the rank stays on screen. */
	tbody th.name {
		max-width: none;
		white-space: normal;
		overflow-wrap: anywhere;
	}

	.main {
		align-items: flex-start;
	}

	.fam {
		min-width: 0;
	}

	tr.head .tag {
		display: none;
	}

	thead th:last-child,
	td:last-child {
		display: none;
	}
}
</style>
