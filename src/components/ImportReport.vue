<script setup lang="ts">
/**
 * What the last import pass did, at a glance.
 *
 * The headline numbers are the three a user acts on. The rest are not what
 * their names suggest — `aborts` is files that matched no attempt, `skipped`
 * mixes already-imported stems with unsupported types — so they are spelled out
 * inside the disclosure rather than shown as bare figures.
 *
 * A missing performance file is not a broken import: the attempt is still a
 * complete result, only its within-run detail is unavailable. That is why
 * orphans sit beside failures under one honest heading instead of being styled
 * as errors.
 */
import { computed } from 'vue';
import type { IngestReport } from '../lib/ingest/report';

const props = defineProps<{ report: IngestReport; at: string | null }>();

const issues = computed(() => {
	const r = props.report;
	const rows: { text: string; bad: boolean }[] = [];
	for (const failure of r.failures) {
		rows.push({ text: `${failure.name} — ${failure.error}`, bad: true });
	}
	if (r.aborts > 0) {
		rows.push({ text: `${r.aborts} file(s) could not be matched to an attempt.`, bad: true });
	}
	if (r.orphanPerfs.length > 0) {
		rows.push({
			text: `${r.orphanPerfs.length} detail file(s) matched no attempt. Those attempts are still complete.`,
			bad: false,
		});
	}
	if (r.ambiguousPerfs.length > 0) {
		rows.push({
			text: `${r.ambiguousPerfs.length} detail file(s) matched more than one attempt and were left unattached.`,
			bad: false,
		});
	}
	if (r.hashMismatches.length > 0) {
		rows.push({
			text: `${r.hashMismatches.length} detail file(s) named a different scenario version than the attempt they matched.`,
			bad: false,
		});
	}
	return rows;
});

const failed = computed(() => issues.value.some((issue) => issue.bad));
</script>

<template>
	<section class="report" aria-labelledby="report-heading">
		<h2 id="report-heading">
			Last import
			<span v-if="at !== null" class="at">{{ at }}</span>
		</h2>

		<dl class="counts">
			<div>
				<dt>Attempts added</dt>
				<dd>{{ report.runs }}</dd>
			</div>
			<div>
				<dt>Detail files matched</dt>
				<dd>{{ report.perfsMatched }}</dd>
			</div>
			<div>
				<dt>Already imported</dt>
				<dd>{{ report.skipped }}</dd>
			</div>
		</dl>

		<details v-if="issues.length > 0" class="issues" :class="{ failed }">
			<summary>{{ issues.length }} {{ issues.length === 1 ? 'note' : 'notes' }} from this import</summary>
			<p class="muted">Everything else was imported, and nothing already imported was affected.</p>
			<ul>
				<li v-for="issue in issues" :key="issue.text">{{ issue.text }}</li>
			</ul>
		</details>
	</section>
</template>

<style scoped>
.report {
	display: flex;
	flex-direction: column;
	gap: var(--space-3);
}

h2 {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: var(--space-2);
	font-size: 1.125rem;
}

.at {
	color: var(--color-text-muted);
	font-size: 0.8125rem;
	font-weight: 400;
}

.counts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
	gap: var(--space-3);
}

.counts > div {
	display: flex;
	flex-direction: column;
	gap: var(--space-1);
	padding: var(--space-3) var(--space-4);
	border: 1px solid var(--color-border);
	border-radius: 12px;
	background: var(--color-surface);
}

dt {
	color: var(--color-text-muted);
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

dd {
	font-family: var(--font-mono);
	font-size: 1.5rem;
	font-variant-numeric: tabular-nums;
}

.issues {
	padding: var(--space-3) var(--space-4);
	border: 1px solid var(--color-border);
	border-radius: 12px;
	background: var(--color-surface);
	font-size: 0.875rem;
}

.issues.failed {
	border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-border));
}

summary {
	cursor: pointer;
	font-weight: 600;
}

.issues[open] summary {
	margin-bottom: var(--space-2);
}

.muted {
	color: var(--color-text-muted);
	max-width: 70ch;
}

ul {
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: var(--space-1);
	margin-top: var(--space-2);
}

li {
	color: var(--color-text-muted);
	overflow-wrap: anywhere;
}
</style>
