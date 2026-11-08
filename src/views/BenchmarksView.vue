<script setup lang="ts">
/**
 * The Benchmarks index (docs/benchmarks.md): every family with a sheet, its
 * difficulties' PB ranks as ARC, what you have played first. A search finds
 * benchmarks, difficulties and the scenarios in them. Laid out as Scenarios
 * is: one panel filling the page, its table scrolling inside it.
 */
import { computed, reactive, useTemplateRef, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import BenchmarkIndexTable, { type IndexSection } from '../components/BenchmarkIndexTable.vue';
import { useBenchmarkIndex } from '../composables/useBenchmarkPage';
import { useBenchmarksRoute } from '../composables/useBenchmarksRoute';
import { useDb } from '../composables/useDb';
import { type FamilyMatch, orderFamilies, searchFamilies } from '../lib/benchmarks/catalog';

const { families, error } = useBenchmarkIndex();
const { error: dbError } = useDb();
const { q, setQ } = useBenchmarksRoute();

const searching = computed(() => q.value.trim() !== '');
const now = Date.now();

const sections = computed<IndexSection[] | null>(() => {
	if (families.value === null) return null;
	const { mine, rest } = orderFamilies(families.value);
	const all: IndexSection[] = [
		{ key: 'mine', title: 'Your benchmarks', matches: searchFamilies(mine, q.value) },
		{ key: 'rest', title: 'Not started', matches: searchFamilies(rest, q.value) },
	];
	return all.filter((s) => s.matches.length > 0);
});

const total = computed(() => families.value?.length ?? 0);
const shown = computed(() => sections.value?.reduce((n, s) => n + s.matches.length, 0) ?? 0);

/** Folds the reader opened or closed; otherwise yours and a search's matches are open. Reset by each new search. */
const toggled = reactive(new Map<string, boolean>());
watch(q, () => toggled.clear());

function isOpen(m: FamilyMatch, mine: boolean): boolean {
	return toggled.get(m.family.name) ?? (mine || searching.value);
}

function toggle(m: FamilyMatch, mine: boolean): void {
	toggled.set(m.family.name, !isOpen(m, mine));
}

/* `/` jumps to the search, as on many sites; Escape in it clears it. */
const search = useTemplateRef<HTMLInputElement>('search');
useEventListener(document, 'keydown', (e: KeyboardEvent) => {
	if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
	const t = e.target as HTMLElement | null;
	if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
	e.preventDefault();
	search.value?.focus();
});
</script>

<template>
	<div class="benchmarks" :class="{ fill: sections !== null }">
		<section v-if="dbError" class="notice danger" role="alert">
			<h1>What you played can't be read</h1>
			<p>The local database could not be opened. The benchmarks are listed, but nothing shows as played.</p>
			<p>{{ dbError.message }}</p>
			<RouterLink :to="{ name: 'data' }">Open Data to retry</RouterLink>
		</section>
		<section v-if="error" class="notice danger" role="alert">
			<h1>The benchmarks could not be read</h1>
			<p>{{ error }}</p>
		</section>
		<p v-else-if="sections === null" class="muted">Loading benchmarks…</p>
		<section v-else class="panel" aria-labelledby="benchmarks-heading">
			<header>
				<h1 id="benchmarks-heading">Benchmarks</h1>
				<span class="sub">{{ searching ? `${shown} of ${total}` : total }}</span>
				<span class="sub note">PB ranks are ARC, aimcurve's own composite: not Voltaic's, Evxl's or any official rank.</span>
				<input
					ref="search"
					type="search"
					:value="q"
					placeholder="Search benchmarks or scenarios  ( / )"
					aria-label="Search benchmarks, difficulties or scenarios"
					@input="setQ(($event.target as HTMLInputElement).value)"
					@keydown.escape="setQ('')"
				/>
			</header>
			<BenchmarkIndexTable v-if="sections.length > 0" :sections="sections" :q="q" :is-open="isOpen" :now="now" @toggle="toggle" />
			<p v-else class="none">
				No benchmark, difficulty or scenario matches '{{ q.trim() }}'.
				<button type="button" @click="setQ('')">Clear search</button>
			</p>
		</section>
	</div>
</template>

<style scoped>
.benchmarks {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px 18px 24px;
	min-width: 0;
}

/*
	The panel fills the page's height and the table scrolls inside it, as on
	Scenarios, so the search and column headings stay in view.
*/
.panel {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	max-height: 100%;
	background: var(--color-surface);
	border: 1px solid var(--color-border);
	border-radius: 3px;
	overflow: hidden;
}

.panel > :deep(.scroll) {
	flex: 1 1 auto;
	min-height: 0;
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

input {
	margin-left: auto;
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

.muted {
	color: var(--color-text-muted);
}

.notice {
	display: flex;
	flex-direction: column;
	gap: var(--space-3);
	padding: var(--space-4);
	border: 1px solid var(--color-danger);
	border-radius: 8px;
	background: var(--color-surface);
	max-width: 62ch;
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
