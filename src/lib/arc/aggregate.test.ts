import { describe, expect, it } from 'vitest';
import { smallSnapshot } from '../../../test/helpers/energy';
import { energyTree, evaluate, G, isFull } from './aggregate';
import { describeRank, rankName } from './name';

const ranks = smallSnapshot().benchmarks[1]!.ranks;

describe('E3 G', () => {
	it('matches the table: a weak spot and a one-trick', () => {
		expect(G([0, ...Array(11).fill(5)])).toBeCloseTo(4.17, 2);
		expect(G([8, ...Array(11).fill(3)])).toBeCloseTo(3.28, 2);
	});

	it('is 0 for all zeros and the identity for one child', () => {
		expect(G([0, 0, 0])).toBe(0);
		expect(G([2.7])).toBeCloseTo(2.7, 12);
	});
});

describe('E7 energyTree', () => {
	const tree = energyTree(smallSnapshot(), 1)!;

	it('lists each name once and its ladder on this difficulty', () => {
		expect(tree.names).toEqual(['A', 'B', 'C', 'D', 'Unrated']);
		expect(tree.thresholds[1]).toEqual([100, 200, 300]);
		expect(tree.thresholds[4]).toBeNull();
	});

	it('keeps a duplicate subcategory name and a name in two slots', () => {
		expect(tree.subs.map((s) => s.name)).toEqual(['Dynamic', 'Static', 'Precise', 'Dynamic']);
		expect(tree.subsOf[1]).toEqual([0, 3]);
	});

	it('is null without a tree', () => {
		expect(energyTree(smallSnapshot(), 0)).toBeNull();
	});

	it('flattens a difficulty without a tree on request: every scenario with a ladder there, in one group', () => {
		const flat = energyTree(smallSnapshot(), 0, true)!;
		expect(flat.names).toEqual(['B', 'Unrated']);
		expect(flat.categories).toHaveLength(1);
		expect(flat.subs.map((s) => s.name)).toEqual(['']);
		expect(flat.thresholds[0]).toEqual([1, 2, 3]);
	});
});

describe('E4 evaluate', () => {
	const tree = energyTree(smallSnapshot(), 1)!;
	// A, B, C, D, Unrated
	const some = [2, null, 1, null, 3];

	it('leaves out what was not played when provisional', () => {
		const { nodes, coverage } = evaluate(tree, some, 'provisional');
		// overall, Clicking, Tracking, Dynamic, Static, Precise, Dynamic
		expect(nodes[3]).toBe(2);
		expect(nodes[4]).toBe(1);
		expect(nodes[5]).toBeNull();
		expect(nodes[6]).toBeNull();
		expect(nodes[2]).toBeNull();
		expect(nodes[1]).toBeCloseTo(G([2, 1]), 12);
		expect(nodes[0]).toBeCloseTo(nodes[1]!, 12);
		expect(coverage).toEqual({ scenarios: [2, 4], subs: [2, 4], categories: [1, 2] });
	});

	it('counts the unplayed as 0 when strict, the unrated never', () => {
		const { nodes } = evaluate(tree, some, 'strict');
		expect(nodes[3]).toBe(1);
		expect(nodes[5]).toBe(0);
		expect(nodes[6]).toBe(0);
		expect(nodes[2]).toBe(0);
		expect(nodes[0]).toBeCloseTo(G([G([1, 1]), 0]), 12);
	});

	it('gives nothing when provisional and nothing is played, 0 when strict', () => {
		const none = [null, null, null, null, null];
		expect(evaluate(tree, none, 'provisional').nodes[0]).toBeNull();
		expect(evaluate(tree, none, 'strict').nodes[0]).toBe(0);
	});

	it('agrees in both modes at full coverage', () => {
		const all = [1, 2, 3, 4, null];
		const a = evaluate(tree, all, 'provisional');
		expect(evaluate(tree, all, 'strict').nodes).toEqual(a.nodes);
		expect(isFull(a.coverage)).toBe(true);
	});
});

describe('E5 rank names', () => {
	it('names Unranked, mid-ladder and the overflow', () => {
		expect(rankName(0.4, ranks)).toMatchObject({ k: 0, name: 'Unranked', next: 'Gold' });
		expect(describeRank(1.6, ranks)).toBe('Gold, 60 % to Platinum');
		expect(describeRank(3.4, ranks)).toBe('Diamond, 40 % past the top rank');
		expect(rankName(9, ranks)).toMatchObject({ k: 3, progress: 1 });
	});
});
