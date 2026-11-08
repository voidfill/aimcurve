import { describe, expect, it } from 'vitest';
import { smallSnapshot } from '../../../test/helpers/arc';
import { G } from '../arc/aggregate';
import { fractionalRank } from '../arc/rank';
import { highlight, type IndexFamily, indexFamilies, orderFamilies, type PlayedScenario, searchFamilies } from './catalog';
import type { Snapshot } from './snapshot';

const at = (pb: number, last: number): PlayedScenario => ({ pb, last });

/** The small snapshot with a second Voltaic difficulty (same ladders) and a second family. */
function snapshot(): Snapshot {
	const s = smallSnapshot();
	s.benchmarks.push({ ...s.benchmarks[1]!, id: 459, difficulty: 'Advanced' });
	for (const list of Object.values(s.scenarios)) {
		const own = list.find(([i]) => i === 1);
		if (own) list.push([2, own[1]]);
	}
	s.benchmarks.push({
		...s.benchmarks[1]!,
		id: 900,
		name: 'TSK Mixed',
		difficulty: 'Static',
		tree: [{ name: 'Static', color: '', subs: [{ name: 'Flick', color: '', scenarios: ['Pasu Static', 'E'] }] }],
	});
	s.scenarios['Pasu Static'] = [[3, [10, 20, 30]]];
	s.scenarios.E = [[3, [10, 20, 30]]];
	return s;
}

describe('indexFamilies', () => {
	it('groups difficulties by family in snapshot order, leaving out treeless ones', () => {
		const families = indexFamilies(snapshot(), new Map(), 'provisional');
		expect(families.map((f) => [f.name, f.difficulties.map((d) => d.benchmark.id)])).toEqual([
			['Voltaic S5', [458, 459]],
			['TSK Mixed', [900]],
		]);
	});

	it('counts rated scenarios played and ranks the PBs with ARC', () => {
		const played = new Map([
			['A', at(250, 10)],
			['C', at(150, 30)],
			['Unrated', at(5, 40)],
		]);
		const [voltaic] = indexFamilies(snapshot(), played, 'provisional');
		const d = voltaic!.difficulties[0]!;
		expect([d.played, d.total]).toEqual([2, 4]);
		// Clicking: Dynamic is A alone, Static is C; Tracking has nothing played.
		const ra = fractionalRank([100, 200, 300], 250);
		const rc = fractionalRank([100, 200, 300], 150);
		expect(d.r).toBeCloseTo(G([ra, rc]));
		// The unrated scenario's run still counts as played for the date.
		expect(d.last).toBe(40);
		expect(d.names).toEqual(['A', 'B', 'C', 'D', 'Unrated']);
	});

	it('counts the unplayed as zero in strict mode, and has no rank with nothing played', () => {
		const played = new Map([['A', at(250, 10)]]);
		const [voltaic, tsk] = indexFamilies(snapshot(), played, 'strict');
		const [provisional] = indexFamilies(snapshot(), played, 'provisional');
		expect(voltaic!.difficulties[0]!.r).toBeGreaterThan(0);
		expect(voltaic!.difficulties[0]!.r).toBeLessThan(provisional!.difficulties[0]!.r!);
		expect(tsk!.difficulties[0]!.r).toBeNull();
		expect(tsk!.difficulties[0]!.last).toBeNull();
	});

	it('gives each family its best coverage and its last run', () => {
		const played = new Map([
			['Pasu Static', at(25, 5)],
			['E', at(12, 7)],
			['A', at(250, 9)],
		]);
		const [voltaic, tsk] = indexFamilies(snapshot(), played, 'provisional');
		expect([voltaic!.share, voltaic!.last]).toEqual([0.25, 9]);
		expect([tsk!.share, tsk!.last]).toEqual([1, 7]);
	});
});

describe('orderFamilies', () => {
	const fam = (name: string, share: number, last: number | null): IndexFamily => ({ name, difficulties: [], share, last });

	it('puts played families first, most complete then most recent, and keeps the rest in order', () => {
		const { mine, rest } = orderFamilies([fam('a', 0, null), fam('b', 0.5, 1), fam('c', 1, 1), fam('d', 0.5, 3), fam('e', 0, null)]);
		expect(mine.map((f) => f.name)).toEqual(['c', 'd', 'b']);
		expect(rest.map((f) => f.name)).toEqual(['a', 'e']);
	});
});

describe('searchFamilies', () => {
	const families = indexFamilies(snapshot(), new Map(), 'provisional');
	const shown = (q: string) => searchFamilies(families, q).map((m) => [m.family.name, m.difficulties.map((d) => [d.difficulty.benchmark.difficulty, d.via])]);

	it('keeps everything for an empty query', () => {
		expect(searchFamilies(families, '  ')).toHaveLength(2);
	});

	it('matches the family name, keeping all its difficulties', () => {
		expect(shown('volt')).toEqual([['Voltaic S5', [['Intermediate', []], ['Advanced', []]]]]);
	});

	it('matches a difficulty, every word somewhere, ignoring case', () => {
		expect(shown('voltaic ADV')).toEqual([['Voltaic S5', [['Advanced', []]]]]);
	});

	it('matches a scenario name and says which, every one a word found', () => {
		expect(shown('pasu')).toEqual([['TSK Mixed', [['Static', ['Pasu Static']]]]]);
		expect(shown('tsk static')).toEqual([['TSK Mixed', [['Static', []]]]]);
		expect(shown('intermediate unrated')).toEqual([['Voltaic S5', [['Intermediate', ['Unrated']]]]]);
		expect(shown('pasu zzz')).toEqual([]);
	});

	it('finds nothing for a word nowhere', () => {
		expect(shown('voltaic zzz')).toEqual([]);
	});
});

describe('highlight', () => {
	it('marks every word found, ignoring case, merging overlaps', () => {
		expect(highlight('VT Pasu Novice S5', 'pasu s5')).toEqual([
			{ text: 'VT ', hit: false },
			{ text: 'Pasu', hit: true },
			{ text: ' Novice ', hit: false },
			{ text: 'S5', hit: true },
		]);
		expect(highlight('aaa', 'aa a')).toEqual([{ text: 'aaa', hit: true }]);
	});

	it('leaves the text whole without a query', () => {
		expect(highlight('Voltaic', ' ')).toEqual([{ text: 'Voltaic', hit: false }]);
	});
});
