/**
 * The zoomed window of a chart axis: pure arithmetic behind `useChartZoom`.
 *
 * A view is `[min, max]` in the axis's data units. `null` is the whole
 * domain, so a view that grows back to its bounds snaps to it.
 */
export type View = readonly [number, number];

/**
 * `view` fitted inside `bounds`: no narrower than `minSpan`, shifted rather
 * than cut at an edge, and null once it covers the bounds.
 */
export function clampView(view: View, bounds: View, minSpan: number): View | null {
	const full = bounds[1] - bounds[0];
	const span = Math.max(view[1] - view[0], Math.min(minSpan, full));
	if (!(span < full)) return null;
	const mid = (view[0] + view[1]) / 2;
	const min = Math.min(Math.max(mid - span / 2, bounds[0]), bounds[1] - span);
	return [min, min + span];
}

/** `view` scaled by `factor` around `anchor`, which stays where it is. Above 1 zooms out. */
export function zoomAt(view: View, anchor: number, factor: number): View {
	return [anchor - (anchor - view[0]) * factor, anchor + (view[1] - anchor) * factor];
}

/** `view` moved by `delta`. */
export function panBy(view: View, delta: number): View {
	return [view[0] + delta, view[1] + delta];
}

/** `view` moved the least that brings `value` inside it, with `margin` of its span to spare. */
export function reveal(view: View, value: number, margin = 0.1): View {
	const pad = (view[1] - view[0]) * margin;
	if (value < view[0] + pad) return panBy(view, value - pad - view[0]);
	if (value > view[1] - pad) return panBy(view, value + pad - view[1]);
	return view;
}

/**
 * Min and max of `series` over the grid indices `[i0, i1]`, skipping nulls;
 * null when there is no value.
 */
export function extent(series: readonly (readonly (number | null | undefined)[])[], i0: number, i1: number): View | null {
	let min = Infinity;
	let max = -Infinity;
	for (const ys of series) {
		for (let i = Math.max(0, i0); i <= i1 && i < ys.length; i++) {
			const y = ys[i];
			if (y == null || !Number.isFinite(y)) continue;
			if (y < min) min = y;
			if (y > max) max = y;
		}
	}
	return min <= max ? [min, max] : null;
}

/** The first index of sorted `xs` past `value`, or at it when `inclusive`. */
function search(xs: readonly number[], value: number, inclusive: boolean): number {
	let lo = 0;
	let hi = xs.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (xs[mid]! < value || (!inclusive && xs[mid] === value)) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** The first index of sorted `xs` at or after `value`. */
export function lowerIndex(xs: readonly number[], value: number): number {
	return search(xs, value, true);
}

/** The last index of sorted `xs` at or before `value`. */
export function upperIndex(xs: readonly number[], value: number): number {
	return search(xs, value, false) - 1;
}
