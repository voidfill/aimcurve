<script setup lang="ts">
/**
 * A chart tooltip's card: a head line, then label and value rows. The progress
 * charts and the Benchmarks candle lanes share it; where it sits is the
 * caller's (`style`).
 */
import type { ProgressTip } from './ProgressChart.vue';

defineProps<{ tip: ProgressTip }>();
</script>

<template>
	<div class="tip" aria-live="polite">
		<div class="tip-head">
			<span class="tip-at">{{ tip.head }}</span>
			<span v-if="tip.sub" class="tip-sub">{{ tip.sub }}</span>
		</div>
		<div v-for="row in tip.rows" :key="row.label" class="tip-row">
			<span class="tip-label">{{ row.label }}</span>
			<span class="tip-value" :class="row.tone">{{ row.value }}</span>
		</div>
	</div>
</template>

<style scoped>
.tip {
	z-index: 2;
	min-width: 230px;
	padding: 10px 12px;
	background: #12161a;
	border: 1px solid #2b3238;
	border-radius: 3px;
	box-shadow: 0 6px 22px rgb(0 0 0 / 0.55);
	pointer-events: none;
}

.tip-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 14px;
	padding-bottom: 8px;
	margin-bottom: 8px;
	border-bottom: 1px solid var(--color-border);
	font: 400 11px/1 var(--font-mono);
}

.tip-at {
	font-weight: 500;
	font-size: 12px;
	color: var(--color-text-strong);
}

.tip-sub {
	color: var(--color-text-muted);
}

.tip-row {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 18px;
	padding: 2.5px 0;
}

.tip-label {
	font: 400 11px/1.3 var(--font-mono);
	color: var(--color-text-muted);
	white-space: nowrap;
}

.tip-value {
	font: 400 11.5px/1.3 var(--font-mono);
	font-variant-numeric: tabular-nums;
	color: var(--color-text);
	white-space: nowrap;
}

.tip-value.strong {
	color: var(--color-text-strong);
}

.tip-value.base {
	color: #d8bd86;
}

.tip-value.ahead {
	color: var(--color-ahead);
}

.tip-value.behind {
	color: var(--color-behind);
}
</style>
