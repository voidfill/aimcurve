<script setup lang="ts">
/**
 * The Benchmarks index: deliberately
 * minimal, only the way into a difficulty. Every family in snapshot order,
 * its difficulties one per line, with what has been played.
 */
import { useBenchmarkIndex } from '../composables/useBenchmarkPage';
import { useDb } from '../composables/useDb';

const { families, error } = useBenchmarkIndex();
const { error: dbError } = useDb();
</script>

<template>
	<div class="benchmarks">
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
		<p v-else-if="families === null" class="muted">Loading benchmarks…</p>
		<template v-else>
			<header>
				<h1>Benchmarks</h1>
				<p class="muted">Each difficulty's sheet, with ARC, spread and history.</p>
			</header>
			<div class="families">
				<section v-for="family in families" :key="family.name" class="family">
					<h2>{{ family.name }}</h2>
					<ul>
						<li v-for="d in family.difficulties" :key="d.benchmark.id">
							<RouterLink :to="{ name: 'benchmark', params: { id: d.benchmark.id } }">{{ d.benchmark.difficulty }}</RouterLink>
							<span v-if="d.played" class="muted">{{ d.played }}/{{ d.total }} played</span>
						</li>
					</ul>
				</section>
			</div>
		</template>
	</div>
</template>

<style scoped>
.benchmarks {
	display: flex;
	flex-direction: column;
	gap: 14px;
	padding: 12px 18px 24px;
	min-width: 0;
}

h1 {
	font-weight: 500;
	font-size: 25px;
	letter-spacing: -0.015em;
	color: var(--color-text-strong);
}

header p {
	margin-top: 4px;
	font: 400 12px/1.4 var(--font-mono);
}

.families {
	columns: 260px auto;
	column-gap: 28px;
}

.family {
	break-inside: avoid;
	padding: 10px 0 12px;
}

h2 {
	font: 500 11px/1.3 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.12em;
	color: #c3c9cf;
}

ul {
	list-style: none;
	margin-top: 6px;
}

li {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 4px 10px;
	padding: 2px 0;
	font: 400 12.5px/1.4 var(--font-mono);
}

a {
	color: var(--color-text);
	text-decoration: none;
}

a:hover {
	color: var(--color-accent);
}

.muted {
	color: var(--color-text-faint);
	font-size: 11.5px;
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
</style>
