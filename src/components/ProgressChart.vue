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
 * The x axis zooms and pans (`useChartZoom`), and y fits the runs in view.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useChartZoom } from '../composables/useChartZoom';
import { paintRanks, type RankLadder } from '../lib/benchmarks/paint';
import { yBounds } from '../lib/run/chart-data';
import { NEUTRAL } from '../lib/scenario/config';
import TipCard from './TipCard.vue';

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
	/**
	 * Whether the keyboard steps through every point, not only those with a
	 * dot: a chart of lines alone (ARC) has none. Enter still opens
	 * only a run with a dot.
	 */
	everyPoint?: boolean;
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

const zoom = useChartZoom(plot, {
	// Padded, so the first and last runs sit clear of the edges: half an
	// attempt, each run centred in its slot, or 2 % of the dates, at least an hour.
	bounds: () => {
		const lo = props.x[0] ?? 0;
		const hi = props.x[props.x.length - 1] ?? 0;
		const pad = props.dateAxis ? Math.max(3600, (hi - lo) * 0.02) : 0.5;
		return [lo - pad, hi + pad];
	},
	// Four attempts, or an hour.
	minSpan: () => (props.dateAxis ? 3600 : 4),
	yAuto: (_u, min, max) => yRange(min!, max!),
});

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
	// A dot may overhang the top and bottom, where the y range can end on it. Not
	// the sides: the x domain is padded, and zoomed in, dots out of view stay out.
	ctx.rect(left, top - r, width, height + 2 * r);
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
			...zoom.cursor,
			y: false,
			points: { show: false },
		},
		scales: {
			x: { time: props.dateAxis, ...zoom.scales.x },
			y: zoom.scales.y,
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
			...zoom.hooks,
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
	zoom.attach(u);
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

// The x scale's kind depends on this; everything else is pushed into the live
// instance. A view in attempts means nothing on dates, so the zoom goes too.
watch(
	() => props.dateAxis,
	() => {
		zoom.reset();
		build();
	},
);

watch(
	() => [props.x, props.y, props.best, props.median, props.medianFull],
	() => {
		const u = plot.value;
		if (!u) return;
		u.batch(() => {
			u.setData(aligned(), false);
			zoom.refresh();
		});
		idx.value = null;
	},
);

// The y range depends on the ladder: setting the x scale reruns it.
watch(
	() => props.ranks,
	() => zoom.apply(),
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

/** The next run in `direction` that has a dot, or simply the next with `everyPoint`. */
function step(from: number, direction: 1 | -1): number {
	for (let i = from + direction; i >= 0 && i < props.y.length; i += direction) if (props.everyPoint || props.y[i] != null) return i;
	return from;
}

function moveTo(i: number): void {
	const u = plot.value;
	if (!u || i < 0 || i >= props.x.length) return;
	zoom.revealX(props.x[i]!);
	u.setCursor({ left: u.valToPos(props.x[i]!, 'x'), top: u.bbox.height / uPlot.pxRatio / 2 });
}

function onKey(event: KeyboardEvent): void {
	// Keys on the reset button are its own: Enter there must reset, not open a run.
	if (event.target !== root.value) return;
	const n = props.y.length;
	const current = idx.value;
	let handled = true;
	if (event.key === 'ArrowRight') moveTo(current === null ? step(-1, 1) : step(current, 1));
	else if (event.key === 'ArrowLeft') moveTo(current === null ? step(n, -1) : step(current, -1));
	else if (event.key === 'Home') moveTo(step(-1, 1));
	else if (event.key === 'End') moveTo(step(n, -1));
	else if (event.key === 'Enter' && current !== null && props.y[current] != null) emit('open', current);
	else if (event.key === 'Escape') {
		plot.value?.setCursor({ left: -10, top: -10 });
		zoom.reset();
	}
	else handled = false;
	if (handled) event.preventDefault();
}

/** The gap between the cursor and the tooltip's near edge, CSS px. */
const TIP_GAP = 16;

/**
 * The tooltip's rendered width, measured: it varies with its content, and a
 * guessed width put a flipped tooltip back over the cursor.
 */
const tipEl = ref<InstanceType<typeof TipCard> | null>(null);
const tipWidth = ref(262);
useResizeObserver(tipEl, (entries) => {
	const width = entries[0]?.borderBoxSize?.[0]?.inlineSize ?? (tipEl.value?.$el as HTMLElement | undefined)?.offsetWidth;
	if (width) tipWidth.value = width;
});

/**
 * Right of the cursor while it fits, else left of it. A flipped tooltip is
 * anchored by its right edge, so whatever its width it never covers the cursor.
 */
const tip = computed(() => {
	const i = idx.value;
	if (i === null || i < 0 || i >= props.x.length) return null;
	const content = props.tipFor(i);
	if (content === null) return null;
	const width = (plot.value?.bbox.width ?? 0) / uPlot.pxRatio;
	const flip = cursorLeft.value + TIP_GAP + tipWidth.value > width;
	return {
		...content,
		style: flip ? { right: `${width - cursorLeft.value + TIP_GAP}px` } : { left: `${cursorLeft.value + TIP_GAP}px` },
	};
});
</script>

<template>
	<div
		ref="root"
		class="chart"
		tabindex="0"
		role="img"
		:aria-label="`${label}. Use the left and right arrow keys to step through runs${everyPoint ? '' : ', Enter to open one'}; Escape clears and resets the zoom. Drag across the chart to zoom in.`"
		@keydown="onKey"
		@pointerdown="root?.focus({ preventScroll: true })"
	>
		<Teleport v-if="over" :to="over">
			<TipCard v-if="tip" ref="tipEl" class="at" :tip="tip" :style="tip.style" />
			<button
				v-if="zoom.zoomed.value"
				type="button"
				class="zoom-reset"
				title="Show every run (or press Escape)"
				@click.stop="zoom.reset()"
				@pointerdown.stop
				@mousedown.stop
				@dblclick.stop
			>
				reset zoom
			</button>
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

.at {
	position: absolute;
	top: 12px;
}

.chart :deep(.u-over) {
	overflow: visible;
}

.chart :deep(.u-cursor-x) {
	border-right: 1px solid var(--color-accent);
}
</style>
