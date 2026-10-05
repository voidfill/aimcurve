<script setup lang="ts">
/**
 * A PB or median pill: the rank name and
 * progress, filled from the left toward the next rank. The text is drawn
 * twice, the top copy clipped to the fill in the fill's ink, so it inverts
 * exactly where the fill passes under it.
 */
import { computed } from 'vue';
import type { RankStep } from '../lib/benchmarks/snapshot';
import { describeRank, arcText } from '../lib/arc/name';
import { pill } from '../lib/arc/pill';

const props = defineProps<{
	/** Fractional rank; null for an empty pill. */
	r: number | null;
	ranks: readonly RankStep[];
	/** What the pill shows, for its label: `PB`, `Median of last 20`. */
	label: string;
}>();

const p = computed(() => (props.r === null ? null : pill(props.r, props.ranks)));
const title = computed(() =>
	props.r === null ? `${props.label}: none` : `${props.label}: ${arcText(props.r)} arc · ${describeRank(props.r, props.ranks)}`,
);
</script>

<template>
	<span v-if="p" class="pill" role="img" :aria-label="title" :title="title" :style="{ '--tint': p.tint }">
		<span class="lay" aria-hidden="true"><span class="name">{{ p.name }}</span><span>{{ p.text }}</span></span>
		<span class="fill" aria-hidden="true" :style="{ width: `${p.fill * 100}%`, background: p.color }">
			<span class="lay" :style="{ color: p.ink }"><span class="name">{{ p.name }}</span><span>{{ p.text }}</span></span>
		</span>
	</span>
	<span v-else class="pill empty" role="img" :aria-label="title" :title="title"><span class="lay">—</span></span>
</template>

<style scoped>
.pill {
	--pill-width: 150px;
	position: relative;
	display: block;
	flex: none;
	width: var(--pill-width);
	height: var(--pill-height, 24px);
	border-radius: 999px;
	overflow: hidden;
	background: color-mix(in srgb, var(--tint) 14%, transparent);
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tint) 45%, transparent);
	font: 650 var(--pill-font, 12.5px) / 1 var(--font-sans);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
	color: var(--tint);
}

.pill.empty {
	background: transparent;
	box-shadow: inset 0 0 0 1px var(--color-border);
	color: var(--color-text-faint);
	font-weight: 400;
}

.pill.empty .lay {
	justify-content: center;
}

.lay {
	position: absolute;
	inset: 0 auto 0 0;
	width: var(--pill-width);
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
	padding: 0 11px;
}

.name {
	overflow: hidden;
	text-overflow: ellipsis;
}

.fill {
	position: absolute;
	inset: 0 auto 0 0;
	overflow: hidden;
}
</style>
