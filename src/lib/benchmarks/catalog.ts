/**
 * The Benchmarks index: every difficulty with a sheet, its PB rank as ARC,
 * ordered so what has been played comes first, and searchable by benchmark,
 * difficulty or scenario name. See docs/benchmarks.md.
 */
import { arcTree, type CoverageMode, coverage, evaluate } from '../arc/aggregate';
import { fractionalRank } from '../arc/rank';
import type { Snapshot, SnapshotBenchmark } from './snapshot';

/** A trimmed scenario name's best complete score and its last complete run, epoch ms. */
export interface PlayedScenario {
	pb: number;
	last: number;
}

export interface IndexDifficulty {
	benchmark: SnapshotBenchmark;
	/** Distinct rated scenarios played, and in total. */
	played: number;
	total: number;
	/** The overall's ARC over each scenario's PB; null with nothing rated played. */
	r: number | null;
	/** The last run of any of its scenarios, epoch ms; null when none is played. */
	last: number | null;
	/** Distinct trimmed scenario names, for search. */
	names: readonly string[];
}

export interface IndexFamily {
	name: string;
	difficulties: IndexDifficulty[];
	/** The highest share of rated scenarios played on any one difficulty, 0 to 1. */
	share: number;
	/** The latest of its difficulties' `last`. */
	last: number | null;
}

/**
 * Families in snapshot order, each with its difficulties. A difficulty without
 * a category tree has no sheet and is left out; a family left with none is too.
 */
export function indexFamilies(snapshot: Snapshot, played: ReadonlyMap<string, PlayedScenario>, mode: CoverageMode): IndexFamily[] {
	const families: IndexFamily[] = [];
	snapshot.benchmarks.forEach((b, index) => {
		const tree = arcTree(snapshot, index);
		if (tree === null) return;
		let family = families[families.length - 1];
		if (family?.name !== b.name) families.push((family = { name: b.name, difficulties: [], share: 0, last: null }));

		let last: number | null = null;
		const r = tree.names.map((name, i) => {
			const p = played.get(name);
			if (p === undefined) return null;
			last = Math.max(last ?? p.last, p.last);
			const t = tree.thresholds[i];
			return t ? fractionalRank(t, p.pb) : null;
		});
		const [n, total] = coverage(tree, (i) => r[i] !== null).scenarios;
		const difficulty: IndexDifficulty = {
			benchmark: b,
			played: n,
			total,
			r: n === 0 ? null : evaluate(tree, r, mode).nodes[0]!,
			last,
			names: tree.names,
		};
		family.difficulties.push(difficulty);
		if (total > 0) family.share = Math.max(family.share, n / total);
		if (last !== null) family.last = Math.max(family.last ?? last, last);
	});
	return families;
}

/**
 * The families with anything played, the most complete first and then the most
 * recently played; the rest stay in snapshot order.
 */
export function orderFamilies(families: readonly IndexFamily[]): { mine: IndexFamily[]; rest: IndexFamily[] } {
	const mine = families.filter((f) => f.last !== null);
	mine.sort((a, b) => b.share - a.share || b.last! - a.last!);
	return { mine, rest: families.filter((f) => f.last === null) };
}

export interface DifficultyMatch {
	difficulty: IndexDifficulty;
	/** The scenarios holding a word the benchmark and difficulty names do not, in tree order; empty when they hold all. */
	via: string[];
}

export interface FamilyMatch {
	family: IndexFamily;
	difficulties: DifficultyMatch[];
}

function wordsOf(q: string): string[] {
	return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The difficulties every word of `q` finds, ignoring case: in the benchmark's
 * name, the difficulty's, or a scenario's. Families without a match drop out.
 * An empty query keeps everything.
 */
export function searchFamilies(families: readonly IndexFamily[], q: string): FamilyMatch[] {
	const words = wordsOf(q);
	const out: FamilyMatch[] = [];
	for (const family of families) {
		const difficulties: DifficultyMatch[] = [];
		for (const d of family.difficulties) {
			const own = `${family.name} ${d.benchmark.difficulty}`.toLowerCase();
			const rest = words.filter((w) => !own.includes(w));
			const names = d.names.map((n) => n.toLowerCase());
			if (!rest.every((w) => names.some((n) => n.includes(w)))) continue;
			difficulties.push({ difficulty: d, via: d.names.filter((_, i) => rest.some((w) => names[i]!.includes(w))) });
		}
		if (difficulties.length > 0) out.push({ family, difficulties });
	}
	return out;
}

export interface Segment {
	text: string;
	hit: boolean;
}

/** `text` cut where the words of `q` occur, ignoring case; overlapping and touching hits merge. */
export function highlight(text: string, q: string): Segment[] {
	const lower = text.toLowerCase();
	const hit = new Array<boolean>(text.length).fill(false);
	for (const w of wordsOf(q)) {
		for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + 1)) hit.fill(true, i, i + w.length);
	}
	const out: Segment[] = [];
	for (let i = 0; i < text.length; i++) {
		const last = out[out.length - 1];
		if (last !== undefined && last.hit === hit[i]) last.text += text[i];
		else out.push({ text: text[i]!, hit: hit[i]! });
	}
	return out.length > 0 ? out : [{ text, hit: false }];
}
