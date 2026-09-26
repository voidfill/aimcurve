/**
 * The Scenarios directory's rows, search, sort, benchmark select and URL state
 * (L2, L4, L6, L8 of its design). See docs/superpowers/specs/2026-09-26-scenarios-directory-design.md.
 */
import type { LocationQuery, LocationQueryRaw } from 'vue-router';
import { candidates, pick } from '../benchmarks/pick';
import { rankOf } from '../benchmarks/rank';
import type { Snapshot } from '../benchmarks/snapshot';
import { median } from './config';
import { shortHash } from './link';
import { RECENT_WINDOW, type ScenarioSummary } from './queries';

export interface DirectoryRow extends ScenarioSummary {
	/** The short hash, only when another version shares the name. */
	tag: string | null;
	/** The median of `recent`; null without scores. */
	median: number | null;
	/** Whether the median is over a full window of runs. */
	full: boolean;
	/** `(median − PB) / |PB|`; null without a median or on a zero PB. */
	gap: number | null;
}

export type SortKey = 'name' | 'rank' | 'pb' | 'form' | 'runs' | 'played';
export type SortDir = 'asc' | 'desc';

export interface DirectoryState {
	q: string;
	sort: SortKey;
	dir: SortDir;
	/** The selected KovaaK's benchmark ID (L8); null for all scenarios. */
	bench: number | null;
}

const SORT_KEYS: readonly SortKey[] = ['name', 'rank', 'pb', 'form', 'runs', 'played'];

export const DEFAULT_STATE: DirectoryState = { q: '', sort: 'played', dir: 'desc', bench: null };

/** The direction a column sorts in when first clicked. */
export function defaultDir(key: SortKey): SortDir {
	return key === 'name' ? 'asc' : 'desc';
}

export function directoryRows(scenarios: readonly ScenarioSummary[]): DirectoryRow[] {
	const counts = new Map<string, number>();
	for (const s of scenarios) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
	return scenarios.map((s) => {
		const m = median(s.recent);
		return {
			...s,
			tag: counts.get(s.name)! > 1 ? shortHash(s.hash) : null,
			median: m,
			full: s.recent.length >= RECENT_WINDOW,
			gap: m === null || s.pb === null || s.pb === 0 ? null : (m - s.pb) / Math.abs(s.pb),
		};
	});
}

export function filterRows(rows: readonly DirectoryRow[], q: string): DirectoryRow[] {
	const needle = q.trim().toLowerCase();
	return needle === '' ? [...rows] : rows.filter((r) => r.name.toLowerCase().includes(needle));
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * Sorts by `key` with blanks last in either direction, then by last played,
 * newest first. `rankOf` gives a row's rank index: −1 for unranked, null
 * without a benchmark or PB.
 */
export function sortRows(
	rows: readonly DirectoryRow[],
	key: SortKey,
	dir: SortDir,
	rankOf: (row: DirectoryRow) => number | null,
): DirectoryRow[] {
	const sign = dir === 'asc' ? 1 : -1;
	const byPlayed = (a: DirectoryRow, b: DirectoryRow) => (a.lastPlayed < b.lastPlayed ? 1 : a.lastPlayed > b.lastPlayed ? -1 : 0);

	if (key === 'name')
		return [...rows].sort((a, b) => sign * (collator.compare(a.name, b.name) || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)));
	if (key === 'played') return [...rows].sort((a, b) => -sign * byPlayed(a, b));

	const value = (r: DirectoryRow): number | null =>
		key === 'rank' ? rankOf(r) : key === 'pb' ? r.pb : key === 'form' ? r.gap : r.runs;
	return [...rows].sort((a, b) => {
		const va = value(a);
		const vb = value(b);
		if (va === null || vb === null) return va === vb ? byPlayed(a, b) : va === null ? 1 : -1;
		return sign * (va - vb) || byPlayed(a, b);
	});
}

/** Clicking a column: a new one starts in its default direction, the current one flips. */
export function nextSort(state: Pick<DirectoryState, 'sort' | 'dir'>, key: SortKey): Pick<DirectoryState, 'sort' | 'dir'> {
	if (state.sort === key) return { sort: key, dir: state.dir === 'asc' ? 'desc' : 'asc' };
	return { sort: key, dir: defaultDir(key) };
}

function first(value: LocationQuery[string] | undefined): string | null {
	const v = Array.isArray(value) ? value[0] : value;
	return typeof v === 'string' ? v : null;
}

export function parseDirectoryQuery(query: LocationQuery | LocationQueryRaw): DirectoryState {
	const q = first(query.q as LocationQuery[string]) ?? '';
	const rawSort = first(query.sort as LocationQuery[string]);
	const sort = SORT_KEYS.includes(rawSort as SortKey) ? (rawSort as SortKey) : DEFAULT_STATE.sort;
	const rawDir = first(query.dir as LocationQuery[string]);
	const dir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : defaultDir(sort);
	const rawBench = first(query.bench as LocationQuery[string]);
	const bench = rawBench !== null && /^\d+$/.test(rawBench) ? Number(rawBench) : null;
	return { q, sort, dir, bench };
}

export function directoryQuery(state: DirectoryState): LocationQueryRaw {
	const query: LocationQueryRaw = {};
	if (state.q !== '') query.q = state.q;
	if (state.sort !== DEFAULT_STATE.sort) query.sort = state.sort;
	if (state.dir !== defaultDir(state.sort)) query.dir = state.dir;
	if (state.bench !== null) query.bench = String(state.bench);
	return query;
}

/* ------------------------------------------------------------------ */
/* L8 benchmark select and ranks                                       */
/* ------------------------------------------------------------------ */

export interface BenchmarkGroup {
	name: string;
	/** One per difficulty, in snapshot order. */
	options: { id: number; label: string }[];
}

/** The benchmarks containing at least one row's scenario, grouped by name, in snapshot order. */
export function benchmarkOptions(snapshot: Snapshot, rows: readonly DirectoryRow[]): BenchmarkGroup[] {
	const used = new Set<number>();
	for (const row of rows) {
		const name = row.name.trim();
		if (Object.hasOwn(snapshot.scenarios, name)) for (const [index] of snapshot.scenarios[name]!) used.add(index);
	}
	const groups: BenchmarkGroup[] = [];
	for (const [index, b] of snapshot.benchmarks.entries()) {
		if (!used.has(index)) continue;
		let group = groups.find((g) => g.name === b.name);
		if (group === undefined) groups.push((group = { name: b.name, options: [] }));
		group.options.push({ id: b.id, label: b.difficulty });
	}
	return groups;
}

/** Whether `id` is a benchmark in the snapshot. */
export function hasBenchmark(snapshot: Snapshot, id: number): boolean {
	return snapshot.benchmarks.some((b) => b.id === id);
}

/** The rows whose scenario is in benchmark `id`; every row for an unknown ID. */
export function inBenchmark(rows: readonly DirectoryRow[], snapshot: Snapshot, id: number): DirectoryRow[] {
	if (!hasBenchmark(snapshot, id)) return [...rows];
	return rows.filter((r) => candidates(snapshot, r.name).some((c) => c.benchmark.id === id));
}

export interface PbRank {
	/** The rank index; −1 below the first threshold. */
	k: number;
	name: string;
	color: string | null;
}

/**
 * Hash → the PB's rank; absent without a PB or a benchmark. Without `bench`
 * each row uses its stored pick (keyed by trimmed name) or the default; with
 * it, every row uses that benchmark, and `picks` is ignored.
 */
export function pbRanks(
	rows: readonly DirectoryRow[],
	snapshot: Snapshot,
	picks: Readonly<Record<string, number | null>>,
	bench: number | null,
): Map<string, PbRank> {
	const ranks = new Map<string, PbRank>();
	for (const row of rows) {
		if (row.pb === null) continue;
		const list = candidates(snapshot, row.name);
		let c;
		if (bench !== null) c = list.find((x) => x.benchmark.id === bench) ?? null;
		else {
			const id = picks[row.name.trim()];
			c = pick(list, typeof id === 'number' || id === null ? id : undefined);
		}
		if (c === null) continue;
		const { k } = rankOf(c.thresholds, row.pb);
		const rank = c.benchmark.ranks[k];
		ranks.set(row.hash, k < 0 || rank === undefined ? { k: -1, name: 'Unranked', color: null } : { k, name: rank.name, color: rank.color });
	}
	return ranks;
}
