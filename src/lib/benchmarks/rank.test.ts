import { describe, expect, it } from 'vitest';
import { rankOf } from './rank';

const ladder = [100, 200, 300, 400];

describe('B5 rank', () => {
	it('is unranked below the first threshold, with the first rank next', () => {
		expect(rankOf(ladder, 40)).toEqual({ k: -1, next: 100, nextRank: 0, gap: 60 });
	});

	it('reaches a rank exactly on its threshold', () => {
		expect(rankOf(ladder, 200)).toEqual({ k: 1, next: 300, nextRank: 2, gap: 100 });
	});

	it('is the lower rank between two thresholds', () => {
		expect(rankOf(ladder, 250.5)).toEqual({ k: 1, next: 300, nextRank: 2, gap: 49.5 });
	});

	it('has no next rank at and above the top', () => {
		expect(rankOf(ladder, 400)).toEqual({ k: 3, next: null, nextRank: null, gap: null });
		expect(rankOf(ladder, 9000)).toEqual({ k: 3, next: null, nextRank: null, gap: null });
	});

	it('reaches the higher of tied ranks, and names it as the next one', () => {
		const tied = [100, 200, 200, 300];
		expect(rankOf(tied, 200).k).toBe(2);
		expect(rankOf(tied, 150)).toEqual({ k: 0, next: 200, nextRank: 2, gap: 50 });
	});

	it('handles a single-rank ladder', () => {
		expect(rankOf([500], 499)).toEqual({ k: -1, next: 500, nextRank: 0, gap: 1 });
		expect(rankOf([500], 500)).toEqual({ k: 0, next: null, nextRank: null, gap: null });
	});
});
