<script setup lang="ts">
/**
 * The run window: how many of each scenario's latest runs count as recent
 * (form, the candle and the median pill). One stored setting, so the scenario
 * and Benchmarks pages that both show this control change it for each other.
 */
import { RUN_WINDOWS, useRunWindow } from '../composables/useChartSettings';

const runWindow = useRunWindow();
</script>

<template>
	<label
		class="setting"
		title="How many of each scenario's latest runs count: form, the charts' white line, and on the Benchmarks page the candle and the median pill. Shared by both pages."
	>
		<span>runs</span>
		<select :value="runWindow" @change="runWindow = Number(($event.target as HTMLSelectElement).value)">
			<option v-for="n in RUN_WINDOWS" :key="n" :value="n">last {{ n }}</option>
		</select>
	</label>
</template>

<style scoped>
.setting {
	display: flex;
	align-items: center;
	gap: 6px;
	font: 500 10px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.14em;
	color: var(--color-text-faint);
}

select {
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

select:hover {
	border-color: var(--color-accent);
}

option {
	background: var(--color-surface);
	color: var(--color-text);
}
</style>
