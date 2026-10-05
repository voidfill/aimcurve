/**
 * The single pass over a difficulty's runs (E8, E9 of the custom energy
 * design): every node's PB and form energy after each run inside it, as
 * columnar arrays.
 * See docs/superpowers/specs/2026-10-04-custom-energy-design.md.
 *
 * State per scenario is its PB and its last `N` scores, kept sorted; per
 * subcategory a running sum and count of `r`. A run updates its scenario and
 * subcategories, then recomputes their categories and the overall with `G`.
 *
 * One pass computes one coverage mode: the 16 ms budget for 100k runs does
 * not fit both, and the page shows one at a time. The toggle reruns it.
 */
import { type CoverageMode, type EnergyTree, nodeCount, POWER } from './aggregate';
import { rankScale } from './rank';

/** One scenario row of the run stream query: every hash of a trimmed name. */
export interface StreamScenario {
	id: number;
	/** Trimmed. */
	name: string;
	hash: string;
}

/** The run stream query's result: complete scored runs, ordered by `started_at, id`. */
export interface StreamRows {
	scenarios: StreamScenario[];
	scenarioId: Int32Array;
	runId: Int32Array;
	/** `started_at`, epoch ms. */
	t: Float64Array;
	score: Float64Array;
}

/** The runs of the tree's rated scenarios, in order, by scenario index. */
export interface RunStream {
	sid: Int32Array;
	runId: Int32Array;
	t: Float64Array;
	score: Float64Array;
	/** Per scenario index, its runs in order: indices into the stream. Empty for an unrated one. */
	runsOf: number[][];
	/** Per scenario index, the hash with the most runs; null when unplayed. Unrated ones included. */
	topHash: (string | null)[];
	/** Per scenario index, what was played, unrated ones included: they have runs, just no ladder. */
	played: ScenarioPlayed[];
}

export interface ScenarioPlayed {
	runs: number;
	/** The best score; null when unplayed. */
	pb: number | null;
	/** The last run's `started_at`, epoch ms; null when unplayed. */
	last: number | null;
}

/**
 * Maps the stream to scenario indices. Only rated scenarios' runs are events
 * (the energy needs a ladder); every scenario of the tree counts towards what
 * was played and its most-played hash.
 */
export function toStream(tree: EnergyTree, rows: StreamRows): RunStream {
	const index = new Map(tree.names.map((name, i) => [name, i]));
	const sidOf = new Map<number, number>();
	const hashOf = new Map<number, string>();
	for (const s of rows.scenarios) {
		const i = index.get(s.name);
		if (i === undefined) continue;
		sidOf.set(s.id, i);
		hashOf.set(s.id, s.hash);
	}
	const n = rows.scenarioId.length;
	const keep: number[] = [];
	const played: ScenarioPlayed[] = tree.names.map(() => ({ runs: 0, pb: null, last: null }));
	const hashRuns = tree.names.map(() => new Map<string, number>());
	for (let e = 0; e < n; e++) {
		const scenario = rows.scenarioId[e]!;
		const i = sidOf.get(scenario);
		const score = rows.score[e]!;
		if (i === undefined || !Number.isFinite(score)) continue;
		const p = played[i]!;
		p.runs++;
		if (p.pb === null || score > p.pb) p.pb = score;
		p.last = rows.t[e]!;
		const hash = hashOf.get(scenario)!;
		hashRuns[i]!.set(hash, (hashRuns[i]!.get(hash) ?? 0) + 1);
		if (tree.thresholds[i] !== null) keep.push(e);
	}
	const sid = new Int32Array(keep.length);
	const runId = new Int32Array(keep.length);
	const t = new Float64Array(keep.length);
	const score = new Float64Array(keep.length);
	const runsOf: number[][] = tree.names.map(() => []);
	keep.forEach((e, j) => {
		const i = sidOf.get(rows.scenarioId[e]!)!;
		sid[j] = i;
		runId[j] = rows.runId[e]!;
		t[j] = rows.t[e]!;
		score[j] = rows.score[e]!;
		runsOf[i]!.push(j);
	});
	const topHash = hashRuns.map((counts) => {
		let best: string | null = null;
		let most = 0;
		for (const [hash, count] of counts) if (count > most) [best, most] = [hash, count];
		return best;
	});
	return { sid, runId, t, score, runsOf, topHash, played };
}

export type EnergyInput = 'pb' | 'form';

/** One node's values at the runs inside it, the only points its chart plots. */
export interface NodeHistory {
	/** Indices into the stream, ascending. */
	events: Int32Array;
	/**
	 * After each of them: `values[j × 2]` PB, `values[j × 2 + 1]` form; NaN
	 * where nothing counts. Read through `nodeValue`: a category's and the
	 * overall's are kept as the mean `G` term, which is all the pass needs.
	 */
	values: Float64Array;
	/** Whether `values` are mean `G` terms rather than `r`. */
	terms: boolean;
}

export interface History {
	/** Run events in the stream. */
	events: number;
	/** Per node (see `nodeCount`). */
	nodes: NodeHistory[];
	/** Every node's value before any run, `initial[node × 2 + input]`, as stored in `nodes`. */
	initial: Float64Array;
	/** Per scenario index, the event of its first run; −1 when unplayed. */
	firstEvent: Int32Array;
	/** The form window and coverage mode it was computed with. */
	window: number;
	mode: CoverageMode;
}

function slot(input: EnergyInput): number {
	return input === 'form' ? 1 : 0;
}

function orNull(v: number): number | null {
	return Number.isNaN(v) ? null : v;
}

function read(n: NodeHistory, v: number): number | null {
	return orNull(n.terms ? unterm(v) : v);
}

/** A node's value after its own `j`-th run; null where nothing counts. */
export function nodeValue(h: History, node: number, j: number, input: EnergyInput): number | null {
	const n = h.nodes[node]!;
	return read(n, n.values[j * 2 + slot(input)]!);
}

/** A node's value after stream event `e`, whether or not that run is inside it. */
export function valueAt(h: History, e: number, node: number, input: EnergyInput): number | null {
	const { events } = h.nodes[node]!;
	// The last of the node's runs at or before e.
	let lo = 0;
	let hi = events.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (events[mid]! <= e) lo = mid + 1;
		else hi = mid;
	}
	if (lo === 0) return read(h.nodes[node]!, h.initial[node * 2 + slot(input)]!);
	return nodeValue(h, node, lo - 1, input);
}

/** Read once: the pass computes `G` terms on every run. */
const P = POWER;

/** The power-mean term of `x` (see `G`); the pass averages terms, then inverts. */
function term(x: number): number {
	return P === 0 ? Math.log(x + 1) : (x + 1) ** P;
}

function unterm(mean: number): number {
	return P === 0 ? Math.exp(mean) - 1 : mean ** (1 / P) - 1;
}

/**
 * Every node's PB and form `r` after each run inside it, in `mode`. Form is
 * the median of each scenario's last `window` scores (E6).
 */
export function historyPass(tree: EnergyTree, stream: RunStream, window: number, mode: CoverageMode): History {
	const S = tree.names.length;
	const C = tree.categories.length;
	const U = tree.subs.length;
	const K = nodeCount(tree);
	const strict = mode === 'strict';
	const events = stream.sid.length;
	const scales = tree.thresholds.map((t) => (t === null ? null : rankScale(t)));

	// Lists flattened into one typed array each, read from `from[i]` to `from[i + 1]`.
	const flat = (lists: number[][]) => {
		const from = new Int32Array(lists.length + 1);
		lists.forEach((l, i) => (from[i + 1] = from[i]! + l.length));
		return { from, at: Int32Array.from(lists.flat()) };
	};
	const catsOfList = tree.subsOf.map((subs) => [...new Set(subs.map((s) => tree.subs[s]!.category))]);
	/** Per scenario: its subcategories, categories and every node it is inside, each once. */
	const subsOf = flat(tree.subsOf);
	const catsOf = flat(catsOfList);
	const nodesOf = flat(tree.subsOf.map((subs, i) => [0, ...catsOfList[i]!.map((c) => 1 + c), ...new Set(subs.map((s) => 1 + C + s))]));
	const catSubs = flat(tree.categories.map((c) => c.subs));
	const rated = Int32Array.from(tree.subs.map((s) => s.rated));
	const length = new Int32Array(K);
	for (let i = 0; i < S; i++) for (let n = nodesOf.from[i]!; n < nodesOf.from[i + 1]!; n++) length[nodesOf.at[n]!]! += stream.runsOf[i]!.length;
	const nodeEvents = [...length].map((n) => new Int32Array(n));
	const nodeValues = [...length].map((n) => new Float64Array(n * 2));
	const filled = new Int32Array(K);

	const pb = new Float64Array(S).fill(Number.NEGATIVE_INFINITY);
	/** Per scenario, its last `window` scores in arrival order (a ring), and sorted. */
	const ring = new Float64Array(S * window);
	const sorted = new Float64Array(S * window);
	const ringLen = new Int32Array(S);
	const ringAt = new Int32Array(S);
	/** Per input (PB, form) and scenario: the current `r`, NaN until played. */
	const rPb = new Float64Array(S).fill(Number.NaN);
	const rForm = new Float64Array(S).fill(Number.NaN);
	/** Per subcategory: the sums of its played slots' `r`. */
	const sumPb = new Float64Array(U);
	const sumForm = new Float64Array(U);
	const subPlayed = new Int32Array(U);
	const firstEvent = new Int32Array(S).fill(-1);
	/**
	 * Every node's current value as stored, `cur[node × 2 + input]`: `r` for a
	 * subcategory, the mean `G` term for a category or the overall. A
	 * category's term is the mean of its subcategories' terms.
	 */
	const cur = new Float64Array(2 * K).fill(Number.NaN);
	/** Each subcategory's `G` term. */
	const subTerms = new Float64Array(2 * U).fill(Number.NaN);

	// Strict counts the unplayed as 0: before any run, every rated node is 0.
	if (strict) {
		tree.subs.forEach((sub, s) => {
			if (sub.rated === 0) return;
			for (const node of [0, 1 + sub.category]) cur[node * 2] = cur[node * 2 + 1] = term(0);
			cur[(1 + C + s) * 2] = cur[(1 + C + s) * 2 + 1] = 0;
			subTerms[s * 2] = subTerms[s * 2 + 1] = term(0);
		});
	}
	const initial = cur.slice();

	for (let e = 0; e < events; e++) {
		const i = stream.sid[e]!;
		const score = stream.score[e]!;
		const wasPlayed = firstEvent[i]! >= 0;
		if (!wasPlayed) firstEvent[i] = e;

		// The form window: drop the oldest score from the sorted copy, insert the new one.
		const at = i * window;
		let len = ringLen[i]!;
		let hole = len;
		if (len === window) {
			const old = ring[at + ringAt[i]!]!;
			hole = 0;
			while (sorted[at + hole] !== old) hole++;
			for (; hole < len - 1; hole++) sorted[at + hole] = sorted[at + hole + 1]!;
		} else ringLen[i] = ++len;
		ring[at + ringAt[i]!] = score;
		ringAt[i] = ringAt[i]! + 1 === window ? 0 : ringAt[i]! + 1;
		while (hole > 0 && sorted[at + hole - 1]! > score) {
			sorted[at + hole] = sorted[at + hole - 1]!;
			hole--;
		}
		sorted[at + hole] = score;
		const mid = at + (len >> 1);
		const median = len % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;

		if (score > pb[i]!) pb[i] = score;
		const scale = scales[i]!;
		const nextPb = scale(pb[i]!);
		const nextForm = scale(median);
		const dPb = nextPb - (wasPlayed ? rPb[i]! : 0);
		const dForm = nextForm - (wasPlayed ? rForm[i]! : 0);
		rPb[i] = nextPb;
		rForm[i] = nextForm;

		const s0 = subsOf.from[i]!;
		const s1 = subsOf.from[i + 1]!;
		for (let n = s0; n < s1; n++) {
			const s = subsOf.at[n]!;
			sumPb[s]! += dPb;
			sumForm[s]! += dForm;
			if (!wasPlayed) subPlayed[s]!++;
		}
		for (let n = s0; n < s1; n++) {
			const s = subsOf.at[n]!;
			const count = strict ? rated[s]! : subPlayed[s]!;
			const k = (1 + C + s) * 2;
			cur[k] = sumPb[s]! / count;
			cur[k + 1] = sumForm[s]! / count;
			subTerms[s * 2] = term(cur[k]!);
			subTerms[s * 2 + 1] = term(cur[k + 1]!);
		}
		for (let n = catsOf.from[i]!; n < catsOf.from[i + 1]!; n++) {
			const c = catsOf.at[n]!;
			for (let input = 0; input < 2; input++) {
				let sum = 0;
				let count = 0;
				for (let m = catSubs.from[c]!; m < catSubs.from[c + 1]!; m++) {
					const x = subTerms[catSubs.at[m]! * 2 + input]!;
					if (x !== x) continue;
					sum += x;
					count++;
				}
				cur[(1 + c) * 2 + input] = sum / count;
			}
		}
		for (let input = 0; input < 2; input++) {
			let sum = 0;
			let count = 0;
			for (let c = 0; c < C; c++) {
				const x = cur[(1 + c) * 2 + input]!;
				if (x !== x) continue;
				sum += x;
				count++;
			}
			cur[input] = sum / count;
		}

		for (let n = nodesOf.from[i]!; n < nodesOf.from[i + 1]!; n++) {
			const node = nodesOf.at[n]!;
			const j = filled[node]!++;
			nodeEvents[node]![j] = e;
			const out = nodeValues[node]!;
			out[j * 2] = cur[node * 2]!;
			out[j * 2 + 1] = cur[node * 2 + 1]!;
		}
	}

	const nodes = nodeEvents.map((events, k) => ({ events, values: nodeValues[k]!, terms: k <= C }));
	return { events, nodes, initial, firstEvent, window, mode };
}

/** The rated scenarios inside node `node`. */
export function nodeScenarios(tree: EnergyTree, node: number): Set<number> {
	const C = tree.categories.length;
	const out = new Set<number>();
	const addSub = (s: number) => {
		for (const i of tree.subs[s]!.slots) if (tree.thresholds[i] !== null) out.add(i);
	};
	if (node === 0) tree.subs.forEach((_, s) => addSub(s));
	else if (node <= C) for (const s of tree.categories[node - 1]!.subs) addSub(s);
	else addSub(node - 1 - C);
	return out;
}
