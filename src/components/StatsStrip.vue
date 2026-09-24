<script setup lang="ts">
/**
 * The run's recorded statistics (Run view R1). A statistic this run did not
 * record has no cell: an empty cell would read as a zero.
 */
import { computed } from 'vue';
import type { Attempt } from '../lib/run/queries';
import { formatValue } from '../lib/run/format';

const props = defineProps<{ attempt: Attempt }>();

interface Stat {
	key: string;
	value: string;
	unit?: string;
}

const stats = computed(() => {
	const a = props.attempt;
	const out: Stat[] = [];
	if (a.accuracy !== null) out.push({ key: 'accuracy', value: formatValue(a.accuracy * 100, 1), unit: '%' });
	if (a.shots > 0) out.push({ key: 'hits / shots', value: `${formatValue(a.hits)} / ${formatValue(a.shots)}` });
	if (a.kills !== null && a.kills > 0) out.push({ key: 'kills', value: formatValue(a.kills) });
	if (a.avgTtkS !== null && a.kills !== null && a.kills > 0) {
		out.push({ key: 'avg ttk', value: formatValue(a.avgTtkS, 3), unit: 's' });
	}
	if (a.efficiency !== null) out.push({ key: 'efficiency', value: formatValue(a.efficiency * 100, 1), unit: '%' });
	if (a.damageTaken !== null && a.damageTaken > 0) out.push({ key: 'dmg taken', value: formatValue(a.damageTaken, 1) });
	if (a.overshots !== null) out.push({ key: 'overshots', value: formatValue(a.overshots) });
	if (a.avgFps !== null) out.push({ key: 'avg fps', value: formatValue(a.avgFps) });
	return out;
});
</script>

<template>
	<dl v-if="stats.length > 0" class="stats">
		<div v-for="stat in stats" :key="stat.key">
			<dt>{{ stat.key }}</dt>
			<dd>
				{{ stat.value }}<small v-if="stat.unit"> {{ stat.unit }}</small>
			</dd>
		</div>
	</dl>
</template>

<style scoped>
.stats {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
	gap: 1px;
	background: var(--color-border);
	border: 1px solid var(--color-border);
	border-radius: 3px;
	overflow: hidden;
}

.stats > div {
	background: var(--color-bg);
	padding: 5px 11px 7px;
}

dt {
	font: 400 9.5px/1 var(--font-mono);
	text-transform: uppercase;
	letter-spacing: 0.13em;
	color: var(--color-text-faint);
}

dd {
	margin-top: 6px;
	font: 400 16px/1 var(--font-mono);
	font-variant-numeric: tabular-nums;
	color: var(--color-text);
}

small {
	font-size: 11px;
	color: var(--color-text-faint);
}
</style>
