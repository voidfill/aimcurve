import { describe, expect, it } from 'vitest';
import { inkFor } from '../benchmarks/format';
import { lanePosition, laneColumns, laneGradient, rankColorAt, UNRANKED } from './axis';
import { pill } from './pill';

const ranks = [
	{ name: 'Platinum', color: '#2FCFC2' },
	{ name: 'Diamond', color: '#B9F2FF' },
	{ name: 'Jade', color: '#85FA85' },
	{ name: 'Nova', color: '#7900FF' },
];

describe('P4 lane axis', () => {
	it('has n + 1 equal columns, Unranked first', () => {
		const columns = laneColumns(ranks);
		expect(columns.map((c) => c.name)).toEqual(['Unranked', 'Platinum', 'Diamond', 'Jade', 'Nova']);
		for (const c of columns) expect(c.to - c.from).toBeCloseTo(0.2, 12);
		expect(columns[0]!.color).toBe(UNRANKED);
	});

	it('keeps the overflow inside the top column and clamps', () => {
		expect(lanePosition(4.5, 4)).toBeCloseTo(0.9, 12);
		expect(lanePosition(5, 4)).toBe(1);
		expect(lanePosition(7, 4)).toBe(1);
		expect(lanePosition(-1, 4)).toBe(0);
	});

	it('colours by the rank reached', () => {
		expect(rankColorAt(0.9, ranks)).toBe(UNRANKED);
		expect(rankColorAt(1, ranks)).toBe('#2FCFC2');
		expect(rankColorAt(4.7, ranks)).toBe('#7900FF');
		expect(rankColorAt(5, ranks)).toBe('#7900FF');
	});

	it('paints each column in its rank colour, blending only near the edges', () => {
		const stops = laneGradient(ranks);
		expect(stops).toHaveLength(10);
		expect(stops[0]!.offset).toBe(0);
		expect(stops[9]!.offset).toBe(1);
		for (let i = 1; i < stops.length; i++) expect(stops[i]!.offset).toBeGreaterThan(stops[i - 1]!.offset);
		expect(stops[2]!.color).toBe(stops[3]!.color);
	});
});

describe('P8 pills', () => {
	it('mid-rank', () => {
		expect(pill(2.62, ranks)).toMatchObject({ name: 'Diamond', text: '62%' });
		expect(pill(2.62, ranks).fill).toBeCloseTo(0.62, 12);
	});

	it('exactly on a threshold', () => {
		expect(pill(3, ranks)).toMatchObject({ name: 'Jade', text: '0%', fill: 0 });
	});

	it('Unranked is neutral and fills toward rank 1', () => {
		expect(pill(0.4, ranks)).toMatchObject({ name: 'Unranked', text: '40%', color: UNRANKED, tint: UNRANKED });
	});

	it('the top rank shows its overflow, up to the cap', () => {
		expect(pill(4.29, ranks)).toMatchObject({ name: 'Nova', text: '+29' });
		expect(pill(5, ranks)).toMatchObject({ name: 'Nova', text: '+100', fill: 1 });
		expect(pill(9, ranks)).toMatchObject({ text: '+100', fill: 1 });
	});

	it('gives a dark rank colour light ink over its fill', () => {
		expect(pill(4.5, ranks).ink).toBe('#ffffff');
		expect(pill(4.5, ranks).ink).toBe(inkFor('#7900FF'));
		expect(pill(2.5, ranks).ink).toBe('#000000');
	});
});
