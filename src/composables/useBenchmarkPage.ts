/**
 * The Benchmarks pages' data.
 * See docs/benchmarks.md.
 *
 * One difficulty joins the snapshot tree, the run stream, the history pass and
 * the candle statistics into one row per tree node. The stream is reread when
 * an import adds runs (`revision`); the run window reruns the history pass and
 * the candle step, the coverage mode only the history pass and the rows.
 */
import { computed, type ComputedRef, type Ref, ref, shallowRef, watch } from 'vue';
import type { Snapshot, SnapshotBenchmark } from '../lib/benchmarks/snapshot';
import {
	categoryNode,
	type Coverage,
	coverage as coverageOf,
	type CoverageMode,
	type ArcTree,
	arcTree,
	subNode,
} from '../lib/arc/aggregate';
import { rankOf } from '../lib/benchmarks/rank';
import { aggregateChart, type RowChart, scenarioChart } from '../lib/arc/chart';
import { historyPass, nodeScenarios, type RunStream, type StreamRows, toStream } from '../lib/arc/history';
import type { RunLink } from '../lib/arc/queries';
import { aggregateSpread, BODY_MIN, type Spread, spreadPass } from '../lib/arc/spread';
import { errorText } from '../lib/error';
import { loadedSnapshot, loadSnapshot } from './useBenchmarkRank';
import { useCoverageMode, useRunWindow } from './useChartSettings';
import { useSource } from './useSource';

export type RowLevel = 'overall' | 'category' | 'subcategory' | 'scenario';

export interface BenchmarkRow {
	/** Unique on the page, stable across reloads. */
	key: string;
	level: RowLevel;
	name: string;
	/** The aggregate node, or null on a scenario row. */
	node: number | null;
	/** The scenario index, or null on an aggregate row. */
	scenario: number | null;
	state: 'played' | 'unplayed' | 'unrated';
	/** In fractional rank; null unless played. */
	spread: Spread | null;
	/** Whether the candle has a body: enough runs in the window, or an aggregate. */
	body: boolean;
	/** Without a body, each run in the window in `r`, oldest first. */
	ticks: number[];
	/** The age of a scenario's last run when over 30 days ("4 mo ago"), else null. */
	stale: string | null;
	/** The scenario page to link: the hash with the most runs. */
	hash: string | null;
	/** The Evxl colour of the category the row is in; null for the overall or none given. */
	color: string | null;
	/** The keys of the rows this one feeds into, overall first. */
	parents: string[];
	/** A scenario's concrete numbers for its fold; null on an aggregate. */
	facts: ScenarioFacts | null;
	/** An aggregate's rated scenarios played, and in total; null on a scenario. */
	played: [played: number, total: number] | null;
}

/** What a scenario's fold states before its chart: scores, not ranks. */
export interface ScenarioFacts {
	/** The all-time best score; null when unplayed. */
	pb: number | null;
	/** Complete runs, every version of the name. */
	runs: number;
	/** The last run's `started_at`, epoch ms; null when unplayed. */
	last: number | null;
	/** The next rank above the PB on this difficulty's ladder; null at the top or unrated. */
	next: { name: string; at: number; gap: number | null } | null;
	/** The candle's statistics as scores; null unless played and rated. */
	scores: Spread | null;
	/** Runs in the window. */
	window: number;
	/** The rank thresholds on this difficulty; null when unrated. */
	ladder: readonly number[] | null;
}

export type PageState = 'loading' | 'ready' | 'missing' | 'error';

/** A scenario is stale once its last run is more than this old. */
export const STALE_MS = 30 * 86_400_000;

/** `31 d ago`, `4 mo ago`, `2 y ago`. */
export function ageText(ms: number): string {
	const days = Math.floor(ms / 86_400_000);
	if (days < 60) return `${days} d ago`;
	if (days < 365) return `${Math.round(days / 30.44)} mo ago`;
	return `${Math.floor(days / 365)} y ago`;
}

/**
 * The rows in tree order: overall, then each category, its subcategories and
 * their scenarios. A subcategory Evxl left unnamed has no row of its own: its
 * scenarios sit under the category, though it still counts as a subcategory.
 */
export function buildRows(
	tree: ArcTree,
	stream: RunStream,
	spreads: ReturnType<typeof spreadPass>,
	nodes: (Spread | null)[],
	now: number,
): BenchmarkRow[] {
	const aggregate = (
		key: string,
		level: RowLevel,
		name: string,
		node: number,
		color: string | null,
		parents: string[],
	): BenchmarkRow => ({
		key,
		level,
		name,
		node,
		scenario: null,
		state: nodes[node] ? 'played' : 'unplayed',
		spread: nodes[node] ?? null,
		body: nodes[node] != null,
		ticks: [],
		stale: null,
		hash: null,
		color,
		parents,
		facts: null,
		played: playedIn(node),
	});
	const playedIn = (node: number): [number, number] => {
		const inside = [...nodeScenarios(tree, node)];
		return [inside.filter((i) => stream.runsOf[i]!.length > 0).length, inside.length];
	};
	const rows: BenchmarkRow[] = [
		aggregate(
			'overall',
			'overall',
			'Overall',
			0,
			null,
			[],
		),
	];
	tree.categories.forEach((c, ci) => {
		const color = c.color === '' ? null : c.color;
		const cat = `c${ci}`;
		// A lone category equals the overall (G of one value is that value): its row would repeat it.
		if (tree.categories.length > 1) rows.push(aggregate(cat, 'category', c.name, categoryNode(ci), color, ['overall']));
		for (const si of c.subs) {
			const sub = tree.subs[si]!;
			const named = sub.name !== '';
			const parents = named ? ['overall', cat, `s${si}`] : ['overall', cat];
			if (named) rows.push(aggregate(`s${si}`, 'subcategory', sub.name, subNode(tree, si), color, parents.slice(0, 2)));
			sub.slots.forEach((i, slot) => {
				const s = spreads[i] ?? null;
				const thresholds = tree.thresholds[i] ?? null;
				const unrated = thresholds === null;
				const { pb, runs, last } = stream.played[i]!;
				const rank = thresholds === null ? null : rankOf(thresholds, pb ?? Number.NEGATIVE_INFINITY);
				const next =
					rank === null || rank.next === null || rank.nextRank === null
						? null
						: { name: tree.ranks[rank.nextRank]!.name, at: rank.next, gap: pb === null ? null : rank.gap };
				const age = s === null ? 0 : now - s.last;
				rows.push({
					key: `s${si}.${slot}`,
					level: 'scenario',
					name: tree.names[i]!,
					node: null,
					scenario: i,
					state: unrated ? 'unrated' : s === null ? 'unplayed' : 'played',
					spread: s,
					body: s !== null && s.runs >= BODY_MIN,
					ticks: s !== null && s.runs > 1 && s.runs < BODY_MIN ? s.window : [],
					stale: s !== null && age > STALE_MS ? ageText(age) : null,
					hash: stream.topHash[i] ?? null,
					color,
					parents,
					facts: { pb, runs, last, next, scores: s?.scores ?? null, window: s?.runs ?? 0, ladder: thresholds },
					played: null,
				});
			});
		}
	});
	return rows;
}

export interface BenchmarkPageApi {
	state: Ref<PageState>;
	error: Ref<string | null>;
	snapshot: Ref<Snapshot | null>;
	benchmark: ComputedRef<SnapshotBenchmark | null>;
	/** The benchmark's difficulties, in snapshot order: the segmented control. */
	family: ComputedRef<SnapshotBenchmark[]>;
	tree: ComputedRef<ArcTree | null>;
	rows: ComputedRef<BenchmarkRow[]>;
	coverage: ComputedRef<Coverage | null>;
	/** The chart of an open row. */
	chartFor: (row: BenchmarkRow, dateAxis: boolean) => RowChart | null;
	/** Where a chart's run opens in Run. */
	runLink: (runId: number) => Promise<RunLink | null>;
	retry: () => void;
}

export interface BenchmarkPageOptions {
	load?: () => Promise<Snapshot>;
	/** How many latest runs count: form, the candle and the median pill. */
	runWindow?: Ref<number>;
	mode?: Ref<CoverageMode>;
	/** Epoch ms; the stale marks are measured from it. */
	now?: () => number;
	/**
	 * Read only these scenarios' runs, not the whole difficulty's: for a page
	 * that shows one scenario's row. Its own row is exact; the aggregates and
	 * coverage then count only these and mean nothing.
	 */
	only?: Ref<readonly string[]>;
	/** Give a difficulty without a category tree a flat one (see `arcTree`), for one scenario's row. */
	flat?: boolean;
}

/**
 * The snapshot, from the shared load. Null until it has loaded. A failed load
 * is not cached by `loadSnapshot`, so `reload` asks again.
 */
export function useSnapshot(load?: () => Promise<Snapshot>): {
	snapshot: Ref<Snapshot | null>;
	failed: Ref<string | null>;
	reload: () => void;
} {
	const snapshot = shallowRef<Snapshot | null>(load ? null : loadedSnapshot());
	const failed = ref<string | null>(null);
	function reload(): void {
		failed.value = null;
		(load ?? loadSnapshot)().then(
			(loaded) => (snapshot.value = loaded),
			(err: unknown) => (failed.value = errorText(err)),
		);
	}
	if (snapshot.value === null) reload();
	return { snapshot, failed, reload };
}

export function useBenchmarkPage(id: Ref<number>, options: BenchmarkPageOptions = {}): BenchmarkPageApi {
	const { source, revision } = useSource();
	const { snapshot, failed, reload } = useSnapshot(options.load);
	const runWindow = options.runWindow ?? useRunWindow();
	const mode = options.mode ?? useCoverageMode();
	const now = options.now ?? Date.now;

	const index = computed(() => snapshot.value?.benchmarks.findIndex((b) => b.id === id.value) ?? -1);
	const benchmark = computed(() => (index.value < 0 ? null : snapshot.value!.benchmarks[index.value]!));
	const family = computed(() => {
		const b = benchmark.value;
		return b === null ? [] : snapshot.value!.benchmarks.filter((o) => o.name === b.name && o.tree !== null);
	});
	const tree = computed(() => (index.value < 0 ? null : arcTree(snapshot.value!, index.value, options.flat)));

	const state = ref<PageState>('loading');
	const error = ref<string | null>(null);
	const rowsData = shallowRef<{ tree: ArcTree; names: string; rows: StreamRows; at: number } | null>(null);
	let gen = 0;

	async function load(): Promise<void> {
		const handle = source.value;
		const t = tree.value;
		const mine = ++gen;
		if (failed.value !== null) {
			error.value = failed.value;
			state.value = 'error';
			return;
		}
		if (snapshot.value === null || handle === null) return;
		if (t === null) {
			rowsData.value = null;
			state.value = 'missing';
			return;
		}
		const names = options.only?.value ?? t.names;
		const namesKey = JSON.stringify(names);
		// Another difficulty (or another `only`) starts from a clean slate; an import keeps showing this one while it reloads.
		if (rowsData.value?.tree.id !== t.id || rowsData.value.names !== namesKey) {
			rowsData.value = null;
			state.value = 'loading';
		}
		try {
			const rows = await handle.listArcRuns(names);
			if (mine !== gen) return;
			rowsData.value = { tree: t, names: namesKey, rows, at: now() };
			state.value = 'ready';
			error.value = null;
		} catch (err) {
			if (mine !== gen) return;
			error.value = errorText(err);
			state.value = 'error';
		}
	}

	watch([snapshot, tree, source, revision, failed, () => options.only?.value], () => void load(), { immediate: true });

	const stream = computed(() => {
		const d = rowsData.value;
		return d === null ? null : { tree: d.tree, stream: toStream(d.tree, d.rows), at: d.at };
	});
	const history = computed(() => {
		const s = stream.value;
		return s === null ? null : historyPass(s.tree, s.stream, runWindow.value, mode.value);
	});
	const spreads = computed(() => {
		const s = stream.value;
		return s === null ? null : spreadPass(s.tree, s.stream, runWindow.value);
	});
	const rows = computed(() => {
		const s = stream.value;
		const sp = spreads.value;
		if (s === null || sp === null) return [];
		return buildRows(s.tree, s.stream, sp, aggregateSpread(s.tree, sp, mode.value), s.at);
	});
	const coverage = computed(() => {
		const s = stream.value;
		return s === null ? null : coverageOf(s.tree, (i) => s.stream.runsOf[i]!.length > 0);
	});

	function chartFor(row: BenchmarkRow, dateAxis: boolean): RowChart | null {
		const s = stream.value;
		if (s === null) return null;
		if (row.scenario !== null) {
			if (row.state !== 'played') return null;
			return scenarioChart(s.tree, s.stream, row.scenario, runWindow.value, dateAxis);
		}
		// Only aggregate charts need the history pass.
		const h = history.value;
		if (h === null || row.node === null || h.nodes[row.node]!.events.length === 0) return null;
		return aggregateChart(s.tree, s.stream, h, row.node, dateAxis, row.name);
	}

	async function runLink(runId: number): Promise<RunLink | null> {
		const handle = source.value;
		return handle === null ? null : handle.getRunLink(runId);
	}

	function retry(): void {
		if (snapshot.value !== null) return void load();
		// The snapshot failed: show the retry is under way, not the old error.
		state.value = 'loading';
		error.value = null;
		reload();
	}

	return { state, error, snapshot, benchmark, family, tree, rows, coverage, chartFor, runLink, retry };
}

export interface IndexDifficulty {
	benchmark: SnapshotBenchmark;
	/** Distinct rated scenarios played, and in total. */
	played: number;
	total: number;
}

export interface IndexFamily {
	name: string;
	difficulties: IndexDifficulty[];
}

/**
 * The index: families in snapshot order, each with its difficulties and
 * what is played. A difficulty without a category tree has no sheet, and is
 * left out; a family left with none is too.
 */
export function indexFamilies(snapshot: Snapshot, played: ReadonlySet<string>): IndexFamily[] {
	const families: IndexFamily[] = [];
	snapshot.benchmarks.forEach((b, i) => {
		const tree = arcTree(snapshot, i);
		if (tree === null) return;
		let family = families[families.length - 1];
		if (family?.name !== b.name) families.push((family = { name: b.name, difficulties: [] }));
		const c = coverageOf(tree, (s) => played.has(tree.names[s]!));
		family.difficulties.push({ benchmark: b, played: c.scenarios[0], total: c.scenarios[1] });
	});
	return families;
}

export function useBenchmarkIndex(load?: () => Promise<Snapshot>): {
	families: ComputedRef<IndexFamily[] | null>;
	error: Ref<string | null>;
} {
	const { source, revision } = useSource();
	const { snapshot, failed } = useSnapshot(load);
	const played = shallowRef<Set<string>>(new Set());
	const error = ref<string | null>(null);
	let gen = 0;

	async function read(): Promise<void> {
		const handle = source.value;
		const mine = ++gen;
		if (handle === null) return;
		try {
			const names = await handle.listPlayedNames();
			if (mine !== gen) return;
			played.value = names;
			error.value = failed.value;
		} catch (err) {
			if (mine === gen) error.value = errorText(err);
		}
	}

	watch([source, revision], () => void read(), { immediate: true });
	watch(failed, (f) => (error.value = f));

	return {
		families: computed(() => (snapshot.value === null ? null : indexFamilies(snapshot.value, played.value))),
		error,
	};
}
