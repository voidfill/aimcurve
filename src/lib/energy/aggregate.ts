/**
 * A difficulty's category tree and how scenario ranks add up through it (E3,
 * E4 of the custom energy design).
 * See docs/superpowers/specs/2026-10-04-custom-energy-design.md.
 *
 * Subcategory = mean of its scenarios' `r`; category and overall = `G`, the
 * shifted geometric mean. Provisional leaves out what was not played; strict
 * counts it as 0 and keeps every denominator.
 */
import type { RankStep, Snapshot } from '../benchmarks/snapshot';

/** The power mean exponent behind `G`: 0 is geometric, −1 harmonic, 1 arithmetic. */
export const POWER = 0;

/** `G(x₁ … x_k)`: the power mean of `x + 1`, minus 1. Safe at zero. */
export function G(xs: readonly number[]): number {
	if (xs.length === 0) return Number.NaN;
	let sum = 0;
	if (POWER === 0) {
		for (const x of xs) sum += Math.log(x + 1);
		return Math.exp(sum / xs.length) - 1;
	}
	for (const x of xs) sum += (x + 1) ** POWER;
	return (sum / xs.length) ** (1 / POWER) - 1;
}

export type CoverageMode = 'provisional' | 'strict';

export interface TreeSub {
	name: string;
	color: string;
	category: number;
	/** Scenario indices, one per slot; a name in two slots is in both. */
	slots: number[];
	/** Slots with a ladder. */
	rated: number;
}

export interface TreeCategory {
	name: string;
	color: string;
	/** Indices into `subs`. */
	subs: number[];
}

/**
 * One difficulty's tree, flattened for the history pass. Scenarios are by
 * index: each distinct trimmed name once.
 */
export interface EnergyTree {
	id: number;
	benchmark: string;
	difficulty: string;
	ranks: RankStep[];
	/** Distinct trimmed scenario names. */
	names: string[];
	/** Each scenario's ladder on this difficulty; null is unrated (E2). */
	thresholds: (number[] | null)[];
	categories: TreeCategory[];
	subs: TreeSub[];
	/** Per scenario, the subcategories of its slots, with repeats. */
	subsOf: number[][];
}

/** Node indices: 0 is the overall, then the categories, then the subcategories. */
export function nodeCount(tree: EnergyTree): number {
	return 1 + tree.categories.length + tree.subs.length;
}

export function categoryNode(c: number): number {
	return 1 + c;
}

export function subNode(tree: EnergyTree, s: number): number {
	return 1 + tree.categories.length + s;
}

/**
 * The tree of `snapshot.benchmarks[index]`, or null when it has none (E7).
 * With `flat`, a difficulty without a tree gets one unnamed category of one
 * unnamed subcategory holding every scenario with a ladder there: enough for
 * a single scenario's row, though its aggregates mean nothing.
 */
export function energyTree(snapshot: Snapshot, index: number, flat = false): EnergyTree | null {
	const b = snapshot.benchmarks[index];
	if (!b) return null;
	if (!b.tree && !flat) return null;
	const tree = b.tree ?? [
		{
			name: '',
			color: '',
			subs: [
				{
					name: '',
					color: '',
					scenarios: Object.keys(snapshot.scenarios).filter((name) => snapshot.scenarios[name]!.some(([i]) => i === index)),
				},
			],
		},
	];
	const names: string[] = [];
	const ids = new Map<string, number>();
	const idOf = (name: string): number => {
		let i = ids.get(name);
		if (i === undefined) {
			i = names.length;
			ids.set(name, i);
			names.push(name);
		}
		return i;
	};
	const categories: TreeCategory[] = [];
	const subs: TreeSub[] = [];
	tree.forEach((c, ci) => {
		const own: number[] = [];
		for (const s of c.subs) {
			own.push(subs.length);
			subs.push({ name: s.name, color: s.color, category: ci, slots: s.scenarios.map(idOf), rated: 0 });
		}
		categories.push({ name: c.name, color: c.color, subs: own });
	});
	const thresholds = names.map((name) => {
		const list = Object.hasOwn(snapshot.scenarios, name) ? snapshot.scenarios[name]! : [];
		return list.find(([i]) => i === index)?.[1] ?? null;
	});
	const subsOf: number[][] = names.map(() => []);
	subs.forEach((s, si) => {
		for (const i of s.slots) {
			subsOf[i]!.push(si);
			if (thresholds[i] !== null) s.rated++;
		}
	});
	return { id: b.id, benchmark: b.name, difficulty: b.difficulty, ranks: b.ranks, names, thresholds, categories, subs, subsOf };
}

export interface Coverage {
	/** Distinct rated scenarios played, and in total. */
	scenarios: [played: number, total: number];
	/** Subcategories with a played scenario, and those with a rated one. */
	subs: [played: number, total: number];
	categories: [played: number, total: number];
}

export function isFull(c: Coverage): boolean {
	return c.scenarios[0] === c.scenarios[1];
}

/** Which scenarios count: rated, and played unless strict. */
export function coverage(tree: EnergyTree, played: (i: number) => boolean): Coverage {
	let scenarios = 0;
	let total = 0;
	tree.names.forEach((_, i) => {
		if (tree.thresholds[i] === null) return;
		total++;
		if (played(i)) scenarios++;
	});
	const subPlayed = tree.subs.map((s) => s.slots.some((i) => tree.thresholds[i] !== null && played(i)));
	const subRated = tree.subs.map((s) => s.rated > 0);
	const catPlayed = tree.categories.map((c) => c.subs.some((s) => subPlayed[s]));
	const catRated = tree.categories.map((c) => c.subs.some((s) => subRated[s]));
	const count = (xs: boolean[]) => xs.filter(Boolean).length;
	return {
		scenarios: [scenarios, total],
		subs: [count(subPlayed), count(subRated)],
		categories: [count(catPlayed), count(catRated)],
	};
}

export interface TreeValues {
	/** One value per node (see `nodeCount`); null where nothing counts. */
	nodes: (number | null)[];
	coverage: Coverage;
}

/**
 * Every node's value from each scenario's `r` (null when unplayed). Unrated
 * scenarios are skipped in both modes.
 */
export function evaluate(tree: EnergyTree, r: readonly (number | null)[], mode: CoverageMode): TreeValues {
	const strict = mode === 'strict';
	const subValues = tree.subs.map((s) => {
		let sum = 0;
		let count = 0;
		for (const i of s.slots) {
			if (tree.thresholds[i] === null) continue;
			const v = r[i] ?? null;
			if (v === null && !strict) continue;
			sum += v ?? 0;
			count++;
		}
		return count === 0 ? null : sum / count;
	});
	const catValues = tree.categories.map((c) => {
		const xs = c.subs.map((s) => subValues[s]!).filter((v): v is number => v !== null);
		return xs.length === 0 ? null : G(xs);
	});
	const present = catValues.filter((v): v is number => v !== null);
	const overall = present.length === 0 ? null : G(present);
	return {
		nodes: [overall, ...catValues, ...subValues],
		coverage: coverage(tree, (i) => (r[i] ?? null) !== null),
	};
}
