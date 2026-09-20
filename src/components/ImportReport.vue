<script setup lang="ts">
/**
 * What the last import pass actually did.
 *
 * The counts are not what they naively look like, and the labels below say what
 * they really are:
 * - `runs` is every attempt row added, **including resets**, not completed runs.
 * - `aborts` is files that could not be attributed to an attempt.
 * - `skipped` mixes already-imported stems with unsupported file types.
 *
 * A missing performance file is not an invalid CSV: the orphan, ambiguous and
 * hash-mismatch lists live in their own section, under their own explanation,
 * separate from files that genuinely failed.
 */
import { computed } from 'vue';
import type { IngestReport } from '../lib/ingest/report';

const props = defineProps<{ report: IngestReport }>();

const hasPerfNotes = computed(
	() =>
		props.report.orphanPerfs.length > 0 ||
		props.report.ambiguousPerfs.length > 0 ||
		props.report.hashMismatches.length > 0,
);
</script>

<template>
	<section class="report" aria-labelledby="report-heading">
		<h2 id="report-heading">Last import</h2>

		<dl class="counts">
			<div>
				<dt>Files scanned</dt>
				<dd>{{ report.scanned }}</dd>
			</div>
			<div>
				<dt>Attempts added, including resets</dt>
				<dd>{{ report.runs }}</dd>
			</div>
			<div>
				<dt>Files not attributable to an attempt</dt>
				<dd>{{ report.aborts }}</dd>
			</div>
			<div>
				<dt>Performance files matched</dt>
				<dd>{{ report.perfsMatched }}</dd>
			</div>
			<div>
				<dt>Files skipped: already imported or an unsupported type</dt>
				<dd>{{ report.skipped }}</dd>
			</div>
		</dl>

		<div v-if="report.failures.length > 0" class="failures">
			<h3>Files that could not be read or parsed</h3>
			<p class="muted">
				Everything else in this pass was imported, and nothing already imported was affected. These
				files are not remembered as failed — a later import picks them up again.
			</p>
			<ul>
				<li v-for="failure in report.failures" :key="failure.name">
					<span class="name">{{ failure.name }}</span>
					<span class="reason">{{ failure.error }}</span>
				</li>
			</ul>
		</div>

		<div v-if="hasPerfNotes" class="perf">
			<h3>Performance detail</h3>
			<p class="muted">
				These are performance files, not attempts. An attempt whose performance detail is missing is
				still a valid, complete result — only its within-run detail is unavailable.
			</p>
			<p v-if="report.orphanPerfs.length > 0">
				<strong>{{ report.orphanPerfs.length }}</strong> matched no attempt:
				<span class="names">{{ report.orphanPerfs.join(', ') }}</span>
			</p>
			<p v-if="report.ambiguousPerfs.length > 0">
				<strong>{{ report.ambiguousPerfs.length }}</strong> matched more than one attempt and were left
				unattached: <span class="names">{{ report.ambiguousPerfs.join(', ') }}</span>
			</p>
			<p v-if="report.hashMismatches.length > 0">
				<strong>{{ report.hashMismatches.length }}</strong> named a different scenario version than the
				attempt they matched: <span class="names">{{ report.hashMismatches.join(', ') }}</span>
			</p>
		</div>
	</section>
</template>

<style scoped>
.report {
	display: flex;
	flex-direction: column;
	gap: var(--space-3);
}

h2 {
	font-size: 1.125rem;
}

h3 {
	font-size: 0.9375rem;
}

.counts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
	gap: var(--space-3);
}

dt {
	color: var(--color-text-muted);
	font-size: 0.75rem;
}

dd {
	font-family: var(--font-mono);
	font-size: 1.125rem;
}

.failures,
.perf {
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
	padding: var(--space-3);
	border: 1px solid var(--color-border);
	border-radius: 8px;
	background: var(--color-surface);
	font-size: 0.9375rem;
}

.failures {
	border-color: var(--color-danger);
}

ul {
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: var(--space-1);
}

li {
	display: flex;
	flex-wrap: wrap;
	gap: var(--space-2);
}

.name,
.names {
	font-family: var(--font-mono);
	overflow-wrap: anywhere;
}

.reason,
.muted {
	color: var(--color-text-muted);
}

.muted {
	max-width: 70ch;
	font-size: 0.875rem;
}
</style>
