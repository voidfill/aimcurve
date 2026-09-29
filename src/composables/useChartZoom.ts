/**
 * Zoom and pan for a uPlot chart, shared by the pace and progress charts.
 *
 * The views live here, not in uPlot: the chart's scale `range` callbacks read
 * them, so every rescale, rebuild or data change keeps them, and they are
 * applied by setting the x scale, which makes uPlot rerun the y range.
 *
 * - drag across the plot: zoom x to the selection
 * - Ctrl/⌘ + wheel (a trackpad pinch arrives as one): zoom x at the pointer,
 *   then y once the whole domain is in view; only y over the y axis
 * - Shift + wheel, or a sideways swipe: pan x while zoomed
 * - Shift + drag on the plot, or a drag on an axis: pan
 * - double-click, or `reset()`: back to the whole run
 *
 * A plain wheel is left to the page, so the chart never traps scrolling.
 */
import { computed, shallowRef, type ComputedRef, type ShallowRef } from 'vue';
import uPlot from 'uplot';
import { clampView, panBy, reveal, type View, zoomAt } from '../lib/chart/view';

export interface ChartZoomOptions {
	/** The x domain, in data units. */
	bounds: () => View;
	/** The narrowest x view. */
	minSpan: () => number;
	/** The y range while it follows the data; uPlot's min and max are over the x view. */
	yAuto: (u: uPlot, min: number | null, max: number | null) => uPlot.Range.MinMax;
}

export interface ChartZoomApi {
	/** The x view, or null for the whole domain. */
	x: ShallowRef<View | null>;
	/** The y view, or null while y follows the data. */
	y: ShallowRef<View | null>;
	zoomed: ComputedRef<boolean>;
	/** Scale options to spread into the chart's own. */
	scales: { x: uPlot.Scale; y: uPlot.Scale };
	/** Cursor options: drag to select, no built-in double-click. */
	cursor: Pick<uPlot.Cursor, 'drag' | 'bind'>;
	/** Hooks to add to the chart's own. */
	hooks: Pick<uPlot.Hooks.Arrays, 'setSelect'>;
	/** Wires the pointer and wheel input of a new instance. */
	attach: (u: uPlot) => void;
	/** Shows the x view `view` (null for the whole domain), and `yView`, or y following the data. */
	show: (view: View | null, yView?: View | null) => void;
	/** Reapplies the views, rerunning the y range after something it depends on changed. */
	apply: () => void;
	/** Moves the x view, if any, just enough to show `value`. */
	revealX: (value: number) => void;
	/** Refits after a data change: x is kept inside the new bounds, y follows the data again. */
	refresh: () => void;
	reset: () => void;
}

/** Wheel pixels → zoom factor: 100 px of wheel is about 1.2×. */
const WHEEL_ZOOM = 0.0018;
/** Drags shorter than this, in CSS px, are clicks. */
const DRAG_MIN = 6;

export function useChartZoom(plot: ShallowRef<uPlot | null>, options: ChartZoomOptions): ChartZoomApi {
	const x = shallowRef<View | null>(null);
	const y = shallowRef<View | null>(null);
	const zoomed = computed(() => x.value !== null || y.value !== null);

	function xRange(): [number, number] {
		const v = x.value ?? options.bounds();
		return [v[0], v[1]];
	}

	/** Setting x reruns every auto scale, and so the y range callback. */
	function apply(): void {
		const u = plot.value;
		if (!u) return;
		const [min, max] = xRange();
		u.setScale('x', { min, max });
	}

	function setX(view: View | null): void {
		x.value = view === null ? null : clampView(view, options.bounds(), options.minSpan());
		apply();
	}

	function setY(view: View | null): void {
		y.value = view !== null && view[1] > view[0] ? view : null;
		apply();
	}

	function currentY(u: uPlot): View {
		return [u.scales.y!.min!, u.scales.y!.max!];
	}

	const scales = {
		x: { range: (): uPlot.Range.MinMax => xRange() },
		y: {
			range: (u: uPlot, min: number | null, max: number | null): uPlot.Range.MinMax =>
				y.value ? [y.value[0], y.value[1]] : options.yAuto(u, min, max),
		},
	};

	const cursor: ChartZoomApi['cursor'] = {
		drag: { x: true, y: false, setScale: false, dist: DRAG_MIN },
		bind: { dblclick: () => null },
	};

	const hooks: ChartZoomApi['hooks'] = {
		setSelect: [
			(u) => {
				const { left, width } = u.select;
				if (width < DRAG_MIN) return;
				u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
				setX([u.posToVal(left, 'x'), u.posToVal(left + width, 'x')]);
			},
		],
	};

	/** Pointer position over the plot, CSS px from its top left. */
	function local(u: uPlot, e: MouseEvent): { left: number; top: number } {
		const rect = u.over.getBoundingClientRect();
		return { left: e.clientX - rect.left, top: e.clientY - rect.top };
	}

	/** Wheel delta in pixels, whatever the device reports it in. */
	function pixels(e: WheelEvent, delta: number): number {
		return e.deltaMode === 1 ? delta * 16 : e.deltaMode === 2 ? delta * 400 : delta;
	}

	/**
	 * The fitted y span when a zoom-out over the plot ran past the whole x domain
	 * and carried on in y; zooming back in to it hands y back to the fit.
	 */
	let spilled: number | null = null;

	/**
	 * Ctrl + wheel over the plot zooms x. With the whole domain in view, zooming
	 * out goes on vertically, and zooming in retraces that before x narrows.
	 */
	function zoomPlot(u: uPlot, at: { left: number; top: number }, factor: number): void {
		if (x.value !== null || (factor <= 1 && spilled === null)) {
			setX(zoomAt(xRange(), u.posToVal(at.left, 'x'), factor));
			return;
		}
		const current = currentY(u);
		spilled ??= current[1] - current[0];
		const next = zoomAt(current, u.posToVal(at.top, 'y'), factor);
		if (next[1] - next[0] <= spilled) {
			spilled = null;
			setY(null);
		} else setY(next);
	}

	function onWheel(u: uPlot, e: WheelEvent, axis: 'x' | 'y'): void {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			const factor = Math.exp(pixels(e, e.deltaY) * WHEEL_ZOOM);
			const at = local(u, e);
			if (axis === 'y') setY(zoomAt(currentY(u), u.posToVal(at.top, 'y'), factor));
			else zoomPlot(u, at, factor);
			return;
		}
		const sideways = e.shiftKey ? e.deltaX || e.deltaY : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
		if (axis === 'x' && sideways !== 0 && x.value !== null) {
			e.preventDefault();
			const [min, max] = xRange();
			setX(panBy([min, max], (pixels(e, sideways) * (max - min)) / u.over.clientWidth));
		}
	}

	/** Set by a pan that moved, so the click ending it opens nothing. */
	let panned = false;

	/**
	 * A pan by dragging: the data under the pointer follows it along `axes`.
	 * Mouse only: a finger on a phone keeps scrolling the page.
	 */
	function startPan(u: uPlot, e: PointerEvent, axes: { x: boolean; y: boolean }, target: HTMLElement): void {
		if (e.pointerType !== 'mouse' || e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		const x0 = xRange();
		const y0 = currentY(u);
		const width = u.over.clientWidth;
		const height = u.over.clientHeight;
		const start = { left: e.clientX, top: e.clientY };
		target.setPointerCapture(e.pointerId);
		panned = false;
		const move = (m: PointerEvent) => {
			panned = true;
			const dx = m.clientX - start.left;
			const dy = m.clientY - start.top;
			if (axes.y) y.value = panBy(y0, (dy * (y0[1] - y0[0])) / height);
			if (axes.x) x.value = clampView(panBy(x0, (-dx * (x0[1] - x0[0])) / width), options.bounds(), options.minSpan());
			apply();
		};
		const end = () => {
			target.removeEventListener('pointermove', move);
			target.removeEventListener('pointerup', end);
			target.removeEventListener('pointercancel', end);
		};
		target.addEventListener('pointermove', move);
		target.addEventListener('pointerup', end);
		target.addEventListener('pointercancel', end);
	}

	function attach(u: uPlot): void {
		const [xAxis, yAxis] = u.root.querySelectorAll<HTMLElement>('.u-axis');
		u.over.addEventListener('wheel', (e) => onWheel(u, e, 'x'), { passive: false });
		u.over.addEventListener('dblclick', (e) => {
			e.preventDefault();
			reset();
		});
		// Capture on the root, before uPlot's own mousedown starts a selection.
		u.root.addEventListener(
			'pointerdown',
			(e) => {
				if (!e.shiftKey || e.target !== u.over) return;
				startPan(u, e, { x: true, y: true }, u.over);
			},
			{ capture: true },
		);
		u.root.addEventListener(
			'click',
			(e) => {
				if (!panned) return;
				panned = false;
				e.stopPropagation();
			},
			{ capture: true },
		);
		u.root.addEventListener(
			'mousedown',
			(e) => {
				if (e.shiftKey && e.target === u.over) e.stopPropagation();
			},
			{ capture: true },
		);
		if (xAxis) {
			xAxis.classList.add('pan-x');
			xAxis.addEventListener('wheel', (e) => onWheel(u, e, 'x'), { passive: false });
			xAxis.addEventListener('pointerdown', (e) => startPan(u, e, { x: true, y: false }, xAxis));
			xAxis.addEventListener('dblclick', () => setX(null));
		}
		if (yAxis) {
			yAxis.classList.add('pan-y');
			yAxis.addEventListener('wheel', (e) => onWheel(u, e, 'y'), { passive: false });
			yAxis.addEventListener('pointerdown', (e) => startPan(u, e, { x: false, y: true }, yAxis));
			yAxis.addEventListener('dblclick', () => setY(null));
		}
	}

	function revealX(value: number): void {
		const v = x.value;
		if (v === null || (value >= v[0] && value <= v[1])) return;
		setX(reveal(v, value));
	}

	function show(view: View | null, yView: View | null = null): void {
		spilled = null;
		y.value = yView;
		setX(view);
	}

	function refresh(): void {
		spilled = null;
		y.value = null;
		setX(x.value);
	}

	function reset(): void {
		spilled = null;
		x.value = null;
		y.value = null;
		apply();
	}

	return { x, y, zoomed, scales, cursor, hooks, attach, show, apply, revealX, refresh, reset };
}
