<script setup lang="ts">
/**
 * The unified pace chart (Run view R3–R5, R7), drawn with uPlot.
 *
 * One instance per mount. Data and visibility are pushed into it with
 * `setData` / `setSeries`, and it is rebuilt only when the series styling
 * changes: the run kind, or a baseline switching between charted and flat.
 *
 * uPlot draws the lines and the recent band. The rest is painted on its canvas:
 * the green/red gap between the accumulated lines (its colour depends on the
 * sign, which a uPlot band cannot do), bot boundaries, labels and highlights.
 * The tooltip is a Vue element teleported into uPlot's overlay, driven by its
 * cursor, and the keyboard moves the same cursor.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { paintRanks } from '../lib/benchmarks/paint';
import type { RankStep } from '../lib/benchmarks/snapshot';
import type { Encounter } from '../lib/run/bots';
import { type ChartData, yBounds } from '../lib/run/chart-data';
import { formatSigned, formatValue } from '../lib/run/format';

export interface ChartLayers {
	local: boolean;
	accumulated: boolean;
	baseline: boolean;
	baseLocal: boolean;
	recent: boolean;
	ranks: boolean;
}

/** The selected benchmark ladder, and the rank above the run's score (B7 of the benchmark ranks design). */
export interface ChartRanks {
	ranks: readonly RankStep[];
	thresholds: readonly number[];
	next: number | null;
}

const props = defineProps<{
	data: ChartData;
	kind: 'clock' | 'race';
	/** A race's budget: axis and tooltip values show `budget − y` seconds. */
	budget: number | null;
	layers: ChartLayers;
	baseline: { kind: 'charted' | 'flat'; label: string; score: number } | null;
	encounters: readonly Encounter[];
	colors: Map<string, string>;
	/** Encounters to highlight, or null for none. */
	highlight: readonly Encounter[] | null;
	/** The exact cumulative comparison at progress `x`, positive ahead; null without a baseline. */
	readoutAt: ((x: number) => number) | null;
	/** Recent runs contributing to the range. */
	recentCount: number;
	/** This run's elapsed seconds at progress `x`. */
	timeAt: (x: number) => number;
	/** Rank bands, or null when the scenario has no rank. */
	ranks: ChartRanks | null;
}>();

/** The plot's height unless the layout gives the element one (see `.chart`). */
const HEIGHT = 340;
/** Below this a layout-given height is ignored as not yet laid out. */
const MIN_HEIGHT = 120;
const FONT = '10.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const AXIS = '#7a828a';
const GRID = '#171c21';

// Series indices, in drawing order: the recent band first, this run's
// accumulated line last so it is always on top.
const S = { recentHigh: 1, recentLow: 2, recentMean: 3, baseLocal: 4, local: 5, baseAcc: 6, acc: 7 } as const;

const root = ref<HTMLDivElement | null>(null);
const plot = shallowRef<uPlot | null>(null);
const over = shallowRef<HTMLElement | null>(null);
const idx = ref<number | null>(null);
const cursorLeft = ref(0);

const race = computed(() => props.kind === 'race');

/** A projected score as shown: seconds on a race. */
function shown(y: number): number {
	return props.budget === null ? y : props.budget - y;
}

function formatY(y: number): string {
	return race.value ? `${formatValue(shown(y), 2)} s` : formatValue(y, 0);
}

function aligned(): uPlot.AlignedData {
	const d = props.data;
	return [
		d.display,
		d.recentHigh,
		d.recentLow,
		d.recentMean,
		d.baseLocal,
		d.local,
		d.baseAccumulated,
		d.accumulated,
	] as uPlot.AlignedData;
}

/** Which series are visible; a line goes with what it depends on (R4). */
function visibility(): Record<(typeof S)[keyof typeof S], boolean> {
	const l = props.layers;
	const b = props.baseline;
	const recent = l.recent && props.recentCount > 0;
	return {
		[S.recentHigh]: recent && props.recentCount > 1,
		[S.recentLow]: recent && props.recentCount > 1,
		[S.recentMean]: recent,
		[S.baseLocal]: b?.kind === 'charted' && l.baseline && l.local && l.baseLocal,
		[S.local]: l.local,
		[S.baseAcc]: b !== null && l.baseline && l.accumulated,
		[S.acc]: l.accumulated,
	};
}

/* ------------------------------------------------------------------ */
/* Canvas painting                                                     */
/* ------------------------------------------------------------------ */

function textWidth(ctx: CanvasRenderingContext2D, text: string): number {
	return ctx.measureText(text).width;
}

/** x in progress → canvas pixels. */
function px(u: uPlot, x: number): number {
	return u.valToPos(x * props.data.xMax, 'x', true);
}

/** Under the lines: rank bands, highlight tint, accumulated gap, bot boundaries and labels. */
function paintUnder(u: uPlot): void {
	const ctx = u.ctx;
	const { top, height } = u.bbox;
	const ratio = uPlot.pxRatio;
	ctx.save();
	ctx.beginPath();
	ctx.rect(u.bbox.left, top, u.bbox.width, height);
	ctx.clip();

	if (props.ranks && props.layers.ranks) paintRanks(u, props.ranks);

	if (props.highlight) {
		for (const e of props.highlight) {
			const x0 = px(u, e.x0);
			const x1 = px(u, e.x1);
			ctx.fillStyle = 'rgba(95,155,214,0.12)';
			ctx.fillRect(x0, top, x1 - x0, height);
			ctx.fillStyle = 'rgba(95,155,214,0.5)';
			ctx.fillRect(x0, top, ratio, height);
			ctx.fillRect(x1 - ratio, top, ratio, height);
		}
	}

	const vis = visibility();
	if (vis[S.acc] && vis[S.baseAcc]) paintGap(u);

	paintBots(u);
	ctx.restore();
}

function paintGap(u: uPlot): void {
	const ctx = u.ctx;
	const xs = props.data.display;
	const a = props.data.accumulated;
	const b = props.data.baseAccumulated;
	const X = (v: number) => u.valToPos(v, 'x', true);
	const Y = (v: number) => u.valToPos(v, 'y', true);
	const quad = (xa: number, ya: number, ba: number, xb: number, yb: number, bb: number, ahead: boolean) => {
		ctx.fillStyle = ahead ? 'rgba(67,212,146,0.16)' : 'rgba(255,111,97,0.15)';
		ctx.beginPath();
		ctx.moveTo(X(xa), Y(ya));
		ctx.lineTo(X(xb), Y(yb));
		ctx.lineTo(X(xb), Y(bb));
		ctx.lineTo(X(xa), Y(ba));
		ctx.closePath();
		ctx.fill();
	};
	for (let i = 0; i + 1 < xs.length; i++) {
		const a0 = a[i];
		const a1 = a[i + 1];
		const b0 = b[i];
		const b1 = b[i + 1];
		if (a0 == null || a1 == null || b0 == null || b1 == null) continue;
		const d0 = a0 - b0;
		const d1 = a1 - b1;
		if (d0 * d1 >= 0) {
			quad(xs[i]!, a0, b0, xs[i + 1]!, a1, b1, d0 + d1 > 0);
			continue;
		}
		// The lines cross inside this step: split at the crossing.
		const f = d0 / (d0 - d1);
		const xc = xs[i]! + (xs[i + 1]! - xs[i]!) * f;
		const yc = a0 + (a1 - a0) * f;
		quad(xs[i]!, a0, b0, xc, yc, yc, d0 > 0);
		quad(xc, yc, yc, xs[i + 1]!, a1, b1, d1 > 0);
	}
}

/**
 * Run A's plain bot marks, with density rules: boundaries only when the median
 * encounter is at least 12 CSS px wide, a label only where it fits.
 */
function paintBots(u: uPlot): void {
	const list = props.encounters;
	if (list.length === 0) return;
	const ctx = u.ctx;
	const ratio = uPlot.pxRatio;
	const { top, height } = u.bbox;
	const widths = list.map((e) => (px(u, e.x1) - px(u, e.x0)) / ratio).sort((p, q) => p - q);
	const median = widths[Math.floor(widths.length / 2)]!;
	if (median < 12) return;

	const highlighted = new Set(props.highlight?.map((e) => e.index) ?? []);
	ctx.font = `${9.5 * ratio}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
	// uPlot leaves the axis labels' alignment on the context.
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	const boundary = (x: number) => {
		ctx.strokeStyle = '#2b3238';
		ctx.lineWidth = ratio;
		ctx.setLineDash([3 * ratio, 3 * ratio]);
		ctx.beginPath();
		ctx.moveTo(Math.round(x) + 0.5, top);
		ctx.lineTo(Math.round(x) + 0.5, top + height);
		ctx.stroke();
		ctx.setLineDash([]);
	};
	const { left, width } = u.bbox;
	list.forEach((e, k) => {
		const x0 = px(u, e.x0);
		const x1 = px(u, e.x1);
		// A boundary where an engagement starts, and where it ends unless the
		// next one starts within a pixel: dead time between bots then shows as
		// the space between two lines, and the end of the last kill stays visible.
		if (x0 - left > ratio) boundary(x0);
		const next = list[k + 1];
		if ((!next || px(u, next.x0) - x1 > ratio) && left + width - x1 > ratio) boundary(x1);
		const pad = 6 * ratio;
		const swatch = 6 * ratio;
		if (x1 - x0 < textWidth(ctx, e.bot) + swatch + 3 * pad) return;
		ctx.fillStyle = props.colors.get(e.bot) ?? '#2f363d';
		ctx.fillRect(x0 + pad, top + 5 * ratio, swatch, swatch);
		ctx.fillStyle = highlighted.has(e.index) ? '#9cc4ec' : '#8b9299';
		ctx.fillText(e.bot, x0 + pad + swatch + 4 * ratio, top + 4 * ratio);
	});
}

/** Over the lines: dim everything outside the highlighted encounters (Run B). */
function paintOver(u: uPlot): void {
	if (!props.highlight || props.highlight.length === 0) return;
	const ctx = u.ctx;
	const { left, top, width, height } = u.bbox;
	const spans = [...props.highlight].sort((p, q) => p.x0 - q.x0);
	ctx.save();
	ctx.fillStyle = 'rgba(11,13,15,0.62)';
	let cursor = left;
	for (const e of spans) {
		const x0 = px(u, e.x0);
		if (x0 > cursor) ctx.fillRect(cursor, top, x0 - cursor, height);
		cursor = Math.max(cursor, px(u, e.x1));
	}
	if (cursor < left + width) ctx.fillRect(cursor, top, left + width - cursor, height);
	ctx.restore();
}

/* ------------------------------------------------------------------ */
/* uPlot lifecycle                                                     */
/* ------------------------------------------------------------------ */

/** A line series: gaps stay gaps, and no per-point markers on sparse data. */
function line(show: boolean, style: Pick<uPlot.Series, 'stroke' | 'width' | 'dash'>): uPlot.Series {
	return { show, spanGaps: false, points: { show: false }, ...style };
}

function options(width: number, height: number): uPlot.Options {
	const flat = props.baseline?.kind === 'flat';
	const vis = visibility();
	const xMax = props.data.xMax;
	return {
		width,
		height,
		legend: { show: false },
		padding: [18, 12, 0, 0],
		cursor: {
			drag: { x: false, y: false, setScale: false },
			y: false,
			points: {
				size: (_u, i) => (i === S.acc || i === S.baseAcc ? 8 : i === S.local || i === S.baseLocal ? 5 : 0),
				// A zero-size point would still draw its outline as a stray dot.
				width: (_u, _i, size) => (size > 0 ? 2 : 0),
				stroke: () => '#0e1114',
			},
		},
		scales: {
			x: { time: false, range: [0, xMax] },
			y: {
				range: (_u, min, max) => {
					const [lo, hi] = yBounds(min, max, props.ranks, props.layers.ranks);
					return uPlot.rangeNum(lo, hi, 0.1, true);
				},
			},
		},
		axes: [
			{
				stroke: AXIS,
				font: FONT,
				grid: { show: false },
				ticks: { stroke: GRID, width: 1 },
				values: (_u, splits) => splits.map((v) => (props.kind === 'clock' ? `${v}s` : `${v}%`)),
			},
			{
				stroke: AXIS,
				font: FONT,
				size: 56,
				grid: { stroke: GRID, width: 1 },
				ticks: { show: false },
				values: (_u, splits) => splits.map((v) => (race.value ? formatValue(shown(v), 1) : formatValue(v, 0))),
			},
		],
		series: [
			{},
			line(vis[S.recentHigh], { stroke: 'transparent', width: 0 }),
			line(vis[S.recentLow], { stroke: 'transparent', width: 0 }),
			line(vis[S.recentMean], { stroke: 'rgba(142,154,166,0.38)', width: 1 }),
			line(vis[S.baseLocal], { stroke: 'rgba(240,178,63,0.8)', width: 1.1, dash: [4, 3.5] }),
			line(vis[S.local], { stroke: 'rgba(207,214,221,0.85)', width: 1.1 }),
			line(vis[S.baseAcc], { stroke: '#f0b23f', width: flat ? 2 : 2.6, dash: flat ? [2, 4] : [7, 5] }),
			line(vis[S.acc], { stroke: '#ffffff', width: 2.8 }),
		],
		bands: [{ series: [S.recentHigh, S.recentLow], fill: 'rgba(142,154,166,0.13)' }],
		hooks: {
			drawAxes: [paintUnder],
			draw: [paintOver],
			setCursor: [
				(u) => {
					idx.value = u.cursor.idx ?? null;
					cursorLeft.value = u.cursor.left ?? 0;
				},
			],
		},
	};
}

/**
 * A series created hidden never positions its cursor point, which then sits at
 * the plot's corner, so points follow their series' visibility explicitly.
 */
function syncPoints(u: uPlot): void {
	u.root.querySelectorAll<HTMLElement>('.u-cursor-pt').forEach((point, k) => {
		point.style.display = u.series[k + 1]?.show ? '' : 'none';
	});
}

function build(): void {
	plot.value?.destroy();
	const el = root.value;
	if (!el) return;
	const style = getComputedStyle(el);
	const inner = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
	const u = new uPlot(options(Math.max(200, el.clientWidth), plotHeight(inner)), aligned(), el);
	plot.value = u;
	over.value = u.over;
	syncPoints(u);
	idx.value = null;
}

onMounted(build);
onBeforeUnmount(() => plot.value?.destroy());

function plotHeight(content: number): number {
	return content >= MIN_HEIGHT ? Math.floor(content) : HEIGHT;
}

useResizeObserver(root, (entries) => {
	const rect = entries[0]!.contentRect;
	const width = Math.floor(rect.width);
	const height = plotHeight(rect.height);
	const u = plot.value;
	if (u && width > 0 && (width !== u.width || height !== u.height)) u.setSize({ width, height });
});

// Styling depends on these; everything else is pushed into the live instance.
watch(
	() => [props.kind, props.baseline?.kind ?? 'none'],
	() => build(),
);

watch(
	() => props.data,
	() => {
		const u = plot.value;
		if (!u) return;
		u.batch(() => {
			u.setData(aligned(), false);
			u.setScale('x', { min: 0, max: props.data.xMax });
		});
		idx.value = null;
	},
);

watch(
	() => [props.layers, props.recentCount, props.baseline],
	() => {
		const u = plot.value;
		if (!u) return;
		const vis = visibility();
		u.batch(() => {
			for (const [i, show] of Object.entries(vis)) {
				if (u.series[Number(i)]!.show !== show) u.setSeries(Number(i), { show });
			}
		});
		syncPoints(u);
		u.redraw(false);
	},
	{ deep: true },
);

watch(
	() => [props.highlight, props.encounters, props.colors],
	() => plot.value?.redraw(false),
);

// The y range depends on the rank layer. Setting the x scale explicitly is what
// makes uPlot rerun the auto y range, and so the range callback.
watch(
	() => [props.ranks, props.layers.ranks],
	() => plot.value?.setScale('x', { min: 0, max: props.data.xMax }),
);

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

function moveTo(i: number): void {
	const u = plot.value;
	if (!u) return;
	const n = props.data.display.length;
	const next = Math.max(0, Math.min(n - 1, i));
	u.setCursor({ left: u.valToPos(props.data.display[next]!, 'x'), top: u.bbox.height / uPlot.pxRatio / 2 });
}

/** Seconds an arrow key moves the cursor: the grid has a point every 0.01 s. */
const KEY_STEP_S = 1;

/** The grid point nearest `KEY_STEP_S` from `from`, in the run's own time, in `direction`. */
function stepFrom(from: number, direction: 1 | -1): number {
	const x = props.data.x;
	const target = props.timeAt(x[from]!) + direction * KEY_STEP_S;
	let i = from;
	while (i + direction >= 0 && i + direction < x.length && direction * (target - props.timeAt(x[i + direction]!)) > 0) {
		i += direction;
	}
	// `i` is the last point short of the target; the next one may be nearer.
	const next = i + direction;
	if (next < 0 || next >= x.length) return i;
	// Always move: past a race's plateau the next point can be further than a step.
	if (i === from) return next;
	return Math.abs(props.timeAt(x[next]!) - target) < Math.abs(props.timeAt(x[i]!) - target) ? next : i;
}

function onKey(event: KeyboardEvent): void {
	const n = props.data.display.length;
	const current = idx.value;
	let handled = true;
	if (event.key === 'ArrowRight') moveTo(current === null ? 0 : stepFrom(current, 1));
	else if (event.key === 'ArrowLeft') moveTo(current === null ? n - 1 : stepFrom(current, -1));
	else if (event.key === 'Home') moveTo(0);
	else if (event.key === 'End') moveTo(n - 1);
	else if (event.key === 'Escape') plot.value?.setCursor({ left: -10, top: -10 });
	else handled = false;
	if (handled) event.preventDefault();
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

interface TipRow {
	label: string;
	value: string;
	rule: string;
	tone?: 'ahead' | 'behind' | 'base' | 'strong';
}

const tip = computed(() => {
	const i = idx.value;
	if (i === null || i < 0 || i >= props.data.x.length) return null;
	const d = props.data;
	const x = d.x[i]!;
	// The exact time of the point, not a rounded axis value: the grid has a
	// point every 0.01 s of this run, plus its ticks and the baseline's.
	const seconds = `${formatValue(props.timeAt(x), 2)} s`;
	const at = race.value ? `${formatValue(x * 100, 1)}% · ${seconds}` : seconds;
	const bot = props.encounters.find((e) => x >= e.x0 && x <= e.x1)?.bot ?? null;
	const vis = visibility();
	const b = props.baseline;
	const value = (v: number | null | undefined) => (v == null ? '—' : formatY(v));
	const rows: TipRow[] = [];
	if (vis[S.local]) rows.push({ label: 'local · this run', value: value(d.local[i]), rule: '1.5px solid #cfd6dd' });
	if (vis[S.baseLocal] && b) {
		rows.push({ label: `local · ${b.label}`, value: value(d.baseLocal[i]), rule: '1.5px dashed #f0b23f', tone: 'base' });
	}
	if (vis[S.acc]) rows.push({ label: 'accum · this run', value: value(d.accumulated[i]), rule: '3px solid #ffffff', tone: 'strong' });
	if (b && vis[S.baseAcc]) {
		rows.push(
			b.kind === 'flat'
				? { label: b.label, value: formatY(b.score), rule: '2px dotted #f0b23f', tone: 'base' }
				: { label: `accum · ${b.label}`, value: value(d.baseAccumulated[i]), rule: '3px dashed #f0b23f', tone: 'base' },
		);
	}
	if (vis[S.recentMean]) {
		const mean = d.recentMean[i];
		rows.push({ label: `recent mean · ${props.recentCount}`, value: value(mean), rule: '6px solid rgba(142,154,166,.35)' });
	}
	if (b && props.readoutAt) {
		const delta = props.readoutAt(x);
		const unit = race.value ? 's' : 'pts';
		rows.push({
			label: b.kind === 'flat' ? `vs ${b.label.replace(' · no curve', '')} at even pace` : `vs ${b.label}`,
			value: `${formatSigned(delta, race.value ? 2 : 1)} ${unit}`,
			rule: `3px solid ${delta >= 0 ? 'rgba(67,212,146,.55)' : 'rgba(255,111,97,.5)'}`,
			tone: delta > 0 ? 'ahead' : delta < 0 ? 'behind' : undefined,
		});
	}
	const width = (plot.value?.bbox.width ?? 0) / uPlot.pxRatio;
	const flip = cursorLeft.value > width - 280;
	return { at, bot, rows, left: flip ? cursorLeft.value - 262 : cursorLeft.value + 16 };
});
</script>

<template>
	<div
		ref="root"
		class="chart"
		tabindex="0"
		role="img"
		:aria-label="`Pace chart. Use the left and right arrow keys to inspect points; Escape clears.`"
		@keydown="onKey"
		@pointerdown="root?.focus({ preventScroll: true })"
	>
		<Teleport v-if="over" :to="over">
			<div v-if="tip" class="tip" :style="{ left: `${tip.left}px` }" aria-live="polite">
				<div class="tip-head">
					<span class="tip-at">{{ tip.at }}</span>
					<span v-if="tip.bot" class="tip-bot">{{ tip.bot }}</span>
				</div>
				<div v-for="row in tip.rows" :key="row.label" class="tip-row">
					<span class="tip-label"><i :style="{ borderTop: row.rule }" aria-hidden="true"></i>{{ row.label }}</span>
					<span class="tip-value" :class="row.tone">{{ row.value }}</span>
				</div>
			</div>
		</Teleport>
	</div>
</template>

<style scoped>
/*
	Content-box, so the height is the plot's whatever padding a parent adds. A
	parent that sizes the element itself (a flex layout) overrides the height,
	and the plot follows the element.
*/
.chart {
	box-sizing: content-box;
	height: 340px;
	position: relative;
	width: auto;
	min-width: 0;
	cursor: crosshair;
}

.chart:focus-visible {
	outline-offset: 2px;
}

.tip {
	position: absolute;
	top: 16px;
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

.tip-bot {
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
	display: flex;
	align-items: center;
	gap: 7px;
	font: 400 11px/1.3 var(--font-mono);
	color: var(--color-text-muted);
	white-space: nowrap;
}

.tip-label i {
	width: 14px;
	height: 0;
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
