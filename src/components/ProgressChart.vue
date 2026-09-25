<script setup lang="ts">
/**
 * The scenario page's progression chart (S5, S6 of the scenario page design),
 * drawn with uPlot: one dot per completed run, the best-so-far step line and a
 * rolling median, over rank bands when the caller passes a ladder.
 *
 * uPlot draws the two lines and owns the scales, axes and cursor. Dots are
 * painted on its canvas, so each can take its config group's colour, and so
 * can the session rules and the rank bands. The tooltip is a Vue element in
 * uPlot's overlay, driven by its cursor; the keyboard moves the same cursor.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { paintRanks, type RankLadder } from '../lib/benchmarks/paint';
import { yBounds } from '../lib/run/chart-data';
import { NEUTRAL } from '../lib/scenario/config';

export interface ProgressTip {
	head: string;
	sub: string | null;
	rows: { label: string; value: string; tone?: 'ahead' | 'behind' | 'strong' | 'base' }[];
}

const props = defineProps<{
	/** Attempt numbers, or epoch seconds on the date axis. */
	x: readonly number[];
	dateAxis: boolean;
	/** One value per run; null is no dot. */
	y: readonly (number | null)[];
	best: readonly (number | null)[];
	median: readonly (number | null)[];
	/** Whether each median point had a full window behind it. */
	medianFull: readonly boolean[];
	/** Run indices where a new session starts. */
	breaks: readonly number[];
	/** Each run's dot colour; null for the neutral one. */
	colors: readonly (string | null)[];
	/** Runs to emphasise, the rest dimmed; null for none. */
	highlight: readonly boolean[] | null;
	ranks: (RankLadder & { next: number | null }) | null;
	formatY: (v: number) => string;
	tipFor: (i: number) => ProgressTip | null;
	label: string;
}>();

const emit = defineEmits<{ (event: 'open', index: number): void }>();

const HEIGHT = 320;
const FONT = '10.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const AXIS = '#7a828a';
const GRID = '#171c21';

const root = ref<HTMLDivElement | null>(null);
const plot = shallowRef<uPlot | null>(null);
const over = shallowRef<HTMLElement | null>(null);
const idx = ref<number | null>(null);
const cursorLeft = ref(0);

function aligned(): uPlot.AlignedData {
	return [[...props.x], [...props.y], [...props.best], [...props.median]];
}

/* ------------------------------------------------------------------ */
/* Canvas painting                                                     */
/* ------------------------------------------------------------------ */

/** Under the lines: rank bands and session rules. */
function paintUnder(u: uPlot): void {
	const ctx = u.ctx;
	const { left, top, width, height } = u.bbox;
	ctx.save();
	ctx.beginPath();
	ctx.rect(left, top, width, height);
	ctx.clip();
	if (props.ranks) paintRanks(u, props.ranks);
	const ratio = uPlot.pxRatio;
	ctx.strokeStyle = '#232a31';
	ctx.lineWidth = ratio;
	ctx.setLineDash([2 * ratio, 4 * ratio]);
	for (const i of props.breaks) {
		const a = props.x[i - 1];
		const b = props.x[i];
		if (a === undefined || b === undefined) continue;
		const px = Math.round(u.valToPos((a + b) / 2, 'x', true)) + 0.5;
		ctx.beginPath();
		ctx.moveTo(px, top);
		ctx.lineTo(px, top + height);
		ctx.stroke();
	}
	ctx.restore();
}

/** Over the lines: the dots, with a surface ring so overlapping ones stay apart. */
function paintDots(u: uPlot): void {
	const ctx = u.ctx;
	const ratio = uPlot.pxRatio;
	const { left, top, width, height } = u.bbox;
	const r = 3.5 * ratio;
	ctx.save();
	ctx.beginPath();
	ctx.rect(left - r, top - r, width + 2 * r, height + 2 * r);
	ctx.clip();
	ctx.lineWidth = 1.5 * ratio;
	ctx.strokeStyle = '#0e1114';
	const hl = props.highlight;
	// Dimmed dots first, so emphasised ones sit on top of them.
	const order = [...props.y.keys()].sort((a, b) => Number(hl?.[a] ?? true) - Number(hl?.[b] ?? true));
	for (const i of order) {
		const v = props.y[i];
		if (v == null) continue;
		const cx = u.valToPos(props.x[i]!, 'x', true);
		const cy = u.valToPos(v, 'y', true);
		ctx.globalAlpha = hl && !hl[i] ? 0.18 : 1;
		ctx.fillStyle = props.colors[i] ?? NEUTRAL;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
	const i = idx.value;
	const v = i === null ? null : props.y[i];
	if (i !== null && v != null) {
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 2 * ratio;
		ctx.beginPath();
		ctx.arc(u.valToPos(props.x[i]!, 'x', true), u.valToPos(v, 'y', true), r + 2.5 * ratio, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.restore();
}

/* ------------------------------------------------------------------ */
/* uPlot lifecycle                                                     */
/* ------------------------------------------------------------------ */

function yRange(min: number, max: number): uPlot.Range.MinMax {
	const [lo, hi] = yBounds(min, max, props.ranks, props.ranks !== null);
	return uPlot.rangeNum(lo, hi, 0.1, true);
}

const MEDIAN = '#e8ebee';
const MEDIAN_FAINT = 'rgba(232,235,238,0.2)';

/**
 * The median fades in from grey to white while its window fills: a gradient
 * from the first median point to the first with a full window, solid after.
 * uPlot calls this on every draw, so it follows the scale.
 */
function medianStroke(u: uPlot): CanvasGradient | string {
	const first = props.median.findIndex((v) => v != null);
	const full = props.medianFull.indexOf(true);
	if (first === -1 || full <= first) return full === -1 ? MEDIAN_FAINT : MEDIAN;
	const x0 = u.valToPos(props.x[first]!, 'x', true);
	const x1 = u.valToPos(props.x[full]!, 'x', true);
	if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) return MEDIAN;
	const gradient = u.ctx.createLinearGradient(x0, 0, x1, 0);
	gradient.addColorStop(0, MEDIAN_FAINT);
	gradient.addColorStop(1, MEDIAN);
	return gradient;
}

function options(width: number): uPlot.Options {
	return {
		width,
		height: HEIGHT,
		legend: { show: false },
		padding: [14, 12, 0, 0],
		cursor: {
			drag: { x: false, y: false, setScale: false },
			y: false,
			points: { show: false },
		},
		scales: {
			x: { time: props.dateAxis },
			y: { range: (_u, min, max) => yRange(min, max) },
		},
		axes: [
			{
				stroke: AXIS,
				font: FONT,
				grid: { show: false },
				ticks: { stroke: GRID, width: 1 },
				...(props.dateAxis ? {} : { values: (_u: uPlot, splits: number[]) => splits.map((v) => (Number.isInteger(v) ? `#${v}` : '')) }),
			},
			{
				stroke: AXIS,
				font: FONT,
				size: 60,
				grid: { stroke: GRID, width: 1 },
				ticks: { show: false },
				values: (_u, splits) => splits.map((v) => props.formatY(v)),
			},
		],
		series: [
			{},
			// The values carry the cursor and the y range; their dots are painted.
			{ show: true, paths: () => null, points: { show: false } },
			{ stroke: '#f0b23f', width: 1.6, paths: uPlot.paths.stepped!({ align: 1 }), points: { show: false }, spanGaps: true },
			{ stroke: medianStroke, width: 2.4, points: { show: false }, spanGaps: true },
		],
		hooks: {
			drawAxes: [paintUnder],
			draw: [paintDots],
			setCursor: [
				(u) => {
					idx.value = u.cursor.idx ?? null;
					cursorLeft.value = u.cursor.left ?? 0;
				},
			],
		},
	};
}

function build(): void {
	plot.value?.destroy();
	const el = root.value;
	if (!el) return;
	const u = new uPlot(options(Math.max(200, el.clientWidth)), aligned(), el);
	plot.value = u;
	over.value = u.over;
	u.over.addEventListener('click', () => {
		const i = idx.value;
		if (i !== null && props.y[i] != null) emit('open', i);
	});
	idx.value = null;
}

onMounted(build);
onBeforeUnmount(() => plot.value?.destroy());

useResizeObserver(root, (entries) => {
	const width = Math.floor(entries[0]!.contentRect.width);
	if (plot.value && width > 0 && width !== plot.value.width) plot.value.setSize({ width, height: HEIGHT });
});

// The x scale's kind depends on this; everything else is pushed into the live instance.
watch(
	() => props.dateAxis,
	() => build(),
);

watch(
	() => [props.x, props.y, props.best, props.median, props.medianFull],
	() => {
		const u = plot.value;
		if (!u) return;
		u.setData(aligned(), true);
		idx.value = null;
	},
);

// The y range depends on the ladder: resetting the data reruns it.
watch(
	() => props.ranks,
	() => plot.value?.setData(aligned(), true),
);

// The hovered dot's ring is painted. Redrawing only when the run changes
// matters: a redraw updates the cursor, which fires `setCursor` again.
watch(
	() => [props.colors, props.highlight, props.breaks, idx.value],
	() => plot.value?.redraw(false),
);

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

/** The next run in `direction` that has a dot. */
function step(from: number, direction: 1 | -1): number {
	for (let i = from + direction; i >= 0 && i < props.y.length; i += direction) if (props.y[i] != null) return i;
	return from;
}

function moveTo(i: number): void {
	const u = plot.value;
	if (!u || i < 0 || i >= props.x.length) return;
	u.setCursor({ left: u.valToPos(props.x[i]!, 'x'), top: u.bbox.height / uPlot.pxRatio / 2 });
}

function onKey(event: KeyboardEvent): void {
	const n = props.y.length;
	const current = idx.value;
	let handled = true;
	if (event.key === 'ArrowRight') moveTo(current === null ? step(-1, 1) : step(current, 1));
	else if (event.key === 'ArrowLeft') moveTo(current === null ? step(n, -1) : step(current, -1));
	else if (event.key === 'Home') moveTo(step(-1, 1));
	else if (event.key === 'End') moveTo(step(n, -1));
	else if (event.key === 'Enter' && current !== null && props.y[current] != null) emit('open', current);
	else if (event.key === 'Escape') plot.value?.setCursor({ left: -10, top: -10 });
	else handled = false;
	if (handled) event.preventDefault();
}

const tip = computed(() => {
	const i = idx.value;
	if (i === null || i < 0 || i >= props.x.length) return null;
	const content = props.tipFor(i);
	if (content === null) return null;
	const width = (plot.value?.bbox.width ?? 0) / uPlot.pxRatio;
	const flip = cursorLeft.value > width - 280;
	return { ...content, left: flip ? cursorLeft.value - 262 : cursorLeft.value + 16 };
});
</script>

<template>
	<div
		ref="root"
		class="chart"
		tabindex="0"
		role="img"
		:aria-label="`${label}. Use the left and right arrow keys to step through runs, Enter to open one; Escape clears.`"
		@keydown="onKey"
		@pointerdown="root?.focus({ preventScroll: true })"
	>
		<Teleport v-if="over" :to="over">
			<div v-if="tip" class="tip" :style="{ left: `${tip.left}px` }" aria-live="polite">
				<div class="tip-head">
					<span class="tip-at">{{ tip.head }}</span>
					<span v-if="tip.sub" class="tip-sub">{{ tip.sub }}</span>
				</div>
				<div v-for="row in tip.rows" :key="row.label" class="tip-row">
					<span class="tip-label">{{ row.label }}</span>
					<span class="tip-value" :class="row.tone">{{ row.value }}</span>
				</div>
			</div>
		</Teleport>
	</div>
</template>

<style scoped>
.chart {
	position: relative;
	width: 100%;
	min-width: 0;
	cursor: pointer;
}

.chart:focus-visible {
	outline-offset: 2px;
}

.tip {
	position: absolute;
	top: 12px;
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

.chart :deep(.u-over) {
	overflow: visible;
}

.chart :deep(.u-cursor-x) {
	border-right: 1px solid var(--color-accent);
}
</style>
