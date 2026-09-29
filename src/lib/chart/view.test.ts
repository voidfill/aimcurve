import { describe, expect, it } from 'vitest';
import { clampView, extent, lowerIndex, panBy, reveal, upperIndex, zoomAt } from './view';

describe('chart view', () => {
	it('shifts a view back inside its bounds rather than cutting it', () => {
		expect(clampView([-10, 20], [0, 100], 1)).toEqual([0, 30]);
		expect(clampView([90, 120], [0, 100], 1)).toEqual([70, 100]);
	});

	it('snaps to the whole domain once the view covers it', () => {
		expect(clampView([-5, 105], [0, 100], 1)).toBeNull();
		expect(clampView([0, 100], [0, 100], 1)).toBeNull();
	});

	it('stops zooming in at the minimum span, around the same centre', () => {
		expect(clampView([49.9, 50.1], [0, 100], 2)).toEqual([49, 51]);
	});

	it('zooms around an anchor that stays put', () => {
		expect(zoomAt([0, 100], 25, 0.5)).toEqual([12.5, 62.5]);
		expect(zoomAt([12.5, 62.5], 25, 2)).toEqual([0, 100]);
	});

	it('pans by a delta', () => {
		expect(panBy([10, 20], -5)).toEqual([5, 15]);
	});

	it('reveals a value with a margin, moving only as far as needed', () => {
		expect(reveal([10, 20], 15)).toEqual([10, 20]);
		expect(reveal([10, 20], 25)).toEqual([16, 26]);
		expect(reveal([10, 20], 5)).toEqual([4, 14]);
	});

	it('finds the extent of several series over an index window, skipping gaps', () => {
		const a = [5, null, 1, 9, 100];
		const b = [null, -2, 3, null, 0];
		expect(extent([a, b], 1, 3)).toEqual([-2, 9]);
		expect(extent([a], 1, 1)).toBeNull();
	});

	it('finds index windows in a sorted grid', () => {
		const xs = [0, 1, 2, 2, 3];
		expect(lowerIndex(xs, 2)).toBe(2);
		expect(upperIndex(xs, 2)).toBe(3);
		expect(lowerIndex(xs, 1.5)).toBe(2);
		expect(upperIndex(xs, 1.5)).toBe(1);
		expect(upperIndex(xs, -1)).toBe(-1);
		expect(lowerIndex(xs, 9)).toBe(5);
	});
});
