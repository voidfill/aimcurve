<script setup lang="ts">
/**
 * One row's lane (P4–P7 of the benchmarks page design): a flat light tint
 * per rank column, and on them the candle of recent runs: worst, p10–p90, median and
 * the all-time PB.
 *
 * The wicks, the end cap and the body are painted with a lane-wide rank
 * gradient, so every part takes the colour of the rank under it and a body
 * spanning several ranks shows each. The median is white and the PB dot the
 * solid colour of the rank it reaches.
 *
 * Hovering the lane shows `tip()`, the numbers behind the candle, in the progress
 * charts' card: under the lane (over it near the window's bottom), beside the
 * pointer and flipped to its left near the right edge. Touch shows none.
 *
 * The tints are plain HTML behind the SVG. The gradient is each lane's own: a user-space gradient's
 * percentages resolve against the SVG it is defined in.
 */
import { computed, ref, useId } from 'vue';
import { useEventListener, useResizeObserver } from '@vueuse/core';
import type { RankStep } from '../lib/benchmarks/snapshot';
import { chartColor } from '../lib/benchmarks/format';
import { bandOpacity, laneColorAt, laneColumns, laneGradient, lanePosition } from '../lib/energy/axis';
import { describeRank } from '../lib/energy/name';
import type { Spread } from '../lib/energy/spread';
import type { ProgressTip } from './ProgressChart.vue';
import TipCard from './TipCard.vue';

const props = defineProps<{
	ranks: readonly RankStep[];
	spread: Spread | null;
	/** Whether to draw a body; without one, `ticks` and the PB dot. */
	body: boolean;
	ticks: readonly number[];
	/** Shown in place of a candle: `not played`, `unrated`. */
	empty: string | null;
	/** The body's height in px; the rest scales from it. */
	size: number;
	dim: boolean;
	name: string;
	/** The tooltip's content, asked for only while hovered; null for none. */
	tip: () => ProgressTip | null;
}>();

const H = 26;
const MID = H / 2;

const columns = computed(() =>
	laneColumns(props.ranks).map((c) => ({
		...c,
		fill: `color-mix(in srgb, ${chartColor(c.color)} ${Math.round(bandOpacity(c.color) * 100)}%, transparent)`,
	})),
);
const stops = computed(() => laneGradient(props.ranks));
const gradientId = `candle-${useId()}`;
const paint = `url(#${gradientId})`;
const n = computed(() => props.ranks.length);
const x = (r: number) => `${(lanePosition(r, n.value) * 100).toFixed(3)}%`;

const candle = computed(() => {
	const s = props.spread;
	if (s === null) return null;
	return {
		worst: x(s.worst),
		p10: x(s.p10),
		median: x(s.median),
		p90: x(s.p90),
		pb: x(s.pb),
		width: `${((lanePosition(s.p90, n.value) - lanePosition(s.p10, n.value)) * 100).toFixed(3)}%`,
		pbColor: laneColorAt(s.pb, props.ranks),
	};
});

const ticks = computed(() => props.ticks.map((r) => ({ x: x(r), color: laneColorAt(r, props.ranks) })));

/** The gap between the pointer or lane and the tooltip, CSS px. */
const TIP_GAP = 16;

const pointer = ref<{ x: number; lane: DOMRect } | null>(null);
const tipEl = ref<InstanceType<typeof TipCard> | null>(null);
const tipSize = ref({ width: 262, height: 200 });
useResizeObserver(tipEl, (entries) => {
	const box = entries[0]?.borderBoxSize?.[0];
	if (box) tipSize.value = { width: box.inlineSize, height: box.blockSize };
});

function onMove(event: PointerEvent): void {
	if (event.pointerType === 'touch') return void (pointer.value = null);
	pointer.value = { x: event.clientX, lane: (event.currentTarget as HTMLElement).getBoundingClientRect() };
}

// The tooltip is placed in the viewport, so a scroll would leave it behind.
useEventListener(window, 'scroll', () => (pointer.value = null), { passive: true, capture: true });

const content = computed(() => (pointer.value === null ? null : props.tip()));

const tipStyle = computed(() => {
	const p = pointer.value;
	if (p === null || content.value === null) return null;
	const { width, height } = tipSize.value;
	const flip = p.x + TIP_GAP + width > window.innerWidth;
	const above = p.lane.bottom + 8 + height > window.innerHeight;
	return {
		...(flip ? { right: `${window.innerWidth - p.x + TIP_GAP}px` } : { left: `${p.x + TIP_GAP}px` }),
		...(above ? { bottom: `${window.innerHeight - p.lane.top + 8}px` } : { top: `${p.lane.bottom + 8}px` }),
	};
});

const label = computed(() => {
	const s = props.spread;
	if (s === null) return `${props.name}: ${props.empty ?? 'no runs'}`;
	const parts = [`PB ${describeRank(s.pb, props.ranks)}`, `median ${describeRank(s.median, props.ranks)}`];
	if (props.body) parts.push(`p10 to p90 ${describeRank(s.p10, props.ranks)} to ${describeRank(s.p90, props.ranks)}`, `worst ${describeRank(s.worst, props.ranks)}`);
	return `${props.name}: ${parts.join('; ')}`;
});
</script>

<template>
	<div class="lane" @pointermove="onMove" @pointerleave="pointer = null">
		<div class="bands" aria-hidden="true">
			<span v-for="c in columns" :key="c.name" :style="{ background: c.fill }"></span>
		</div>
		<svg :height="H" role="img" :aria-label="label">
			<defs>
				<linearGradient :id="gradientId" gradientUnits="userSpaceOnUse" x1="0%" x2="100%" y1="0" y2="0">
					<stop v-for="(s, i) in stops" :key="i" :offset="s.offset" :stop-color="s.color" />
				</linearGradient>
			</defs>
			<g v-if="candle" :opacity="dim ? 0.5 : 1">
				<template v-if="body">
					<line :x1="candle.worst" :x2="candle.p10" :y1="MID" :y2="MID" :stroke="paint" stroke-width="2" />
					<rect :x="candle.worst" :y="MID - size / 2" width="2" :height="size" :fill="paint" />
					<line :x1="candle.p90" :x2="candle.pb" :y1="MID" :y2="MID" :stroke="paint" stroke-width="2" />
					<rect
						:x="candle.p10"
						:y="MID - size / 2"
						:width="candle.width"
						:height="size"
						rx="3"
						:fill="paint"
						fill-opacity="0.45"
						:stroke="paint"
						stroke-width="1.5"
					/>
					<rect :x="candle.median" :y="MID - size / 2 - 3" width="2.5" :height="size + 6" fill="#ffffff" transform="translate(-1.25 0)" />
				</template>
				<line
					v-for="(t, i) in ticks"
					:key="i"
					:x1="t.x"
					:x2="t.x"
					:y1="MID - size / 2"
					:y2="MID + size / 2"
					:stroke="t.color"
					stroke-width="2"
					stroke-linecap="round"
				/>
				<circle :cx="candle.pb" :cy="MID" :r="size / 2.2" :fill="candle.pbColor" stroke="#0b0d0f" stroke-width="1.5" />
			</g>
		</svg>
		<span v-if="empty" class="empty">{{ empty }}</span>
		<Teleport to="body">
			<TipCard v-if="content && tipStyle" ref="tipEl" class="lane-tip" :tip="content" :style="tipStyle" />
		</Teleport>
	</div>
</template>

<style scoped>
.lane {
	position: relative;
	min-width: 0;
}

/* One flat tint per rank column, equal widths, edge to edge; the strip's ends slightly rounded. */
.bands {
	position: absolute;
	inset: 0;
	display: flex;
	border-radius: 4px;
	overflow: hidden;
}

.bands span {
	flex: 1;
}

.lane-tip {
	position: fixed;
	z-index: 50;
}

svg {
	position: relative;
	display: block;
	width: 100%;
	overflow: visible;
}

.empty {
	position: absolute;
	inset: 0 auto 0 8px;
	display: flex;
	align-items: center;
	font: 400 11.5px/1 var(--font-mono);
	color: var(--color-text-faint);
	text-shadow: 0 0 4px var(--color-surface), 0 0 2px var(--color-surface);
	pointer-events: none;
}
</style>
