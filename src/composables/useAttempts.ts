/**
 * The Run view's data: the attempt rail, the selected attempt, the scenario
 * filter options, and the "newer attempt available" indicator.
 *
 * Not a singleton — it is created by the Run view and its watchers stop with
 * that component. Nothing here owns import state, so leaving and re-entering
 * Run re-queries the database but never touches a worker, a watcher, or a
 * connection.
 *
 * Vue's reactivity does not order async results, so every concern below keeps
 * its own request generation counter: a dispatch increments it, and a resolved
 * result whose generation is stale is discarded rather than written.
 */
import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import type { PGliteInterface } from '@electric-sql/pglite';
import {
	getAttempt,
	getLatestAttempt,
	listAttempts,
	listScenarios,
	type Attempt,
	type AttemptCursor,
	type ScenarioOption,
} from '../lib/run/queries';
import { errorText } from '../lib/error';
import { useDb } from './useDb';
import { useImport } from './useImport';
import { useSelection } from './useSelection';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
/** `pending` while the options that would resolve the hash are still loading. */
export type FilterState = 'all' | 'pending' | 'known' | 'unknown';
export type SelectionState = 'idle' | 'loading' | 'ready' | 'missing' | 'empty' | 'error';

export interface AttemptsApi {
	scenarios: Ref<ScenarioOption[]>;
	scenariosError: Ref<string | null>;
	filterState: ComputedRef<FilterState>;
	scenarioId: ComputedRef<number | null>;

	items: Ref<Attempt[]>;
	railState: Ref<LoadState>;
	railError: Ref<string | null>;
	hasMore: ComputedRef<boolean>;
	loadingOlder: Ref<boolean>;
	loadOlder: () => Promise<void>;

	selected: Ref<Attempt | null>;
	selectionState: Ref<SelectionState>;
	selectionError: Ref<string | null>;
	/** The inspected attempt is not in the scenario the filter selects. */
	selectionOutsideFilter: ComputedRef<boolean>;
	/** The inspected attempt matches the filter but is not in the loaded page. */
	selectionOffPage: ComputedRef<boolean>;

	hasNewer: Ref<boolean>;
	/** Re-run every query, for the retry controls. */
	retry: () => void;
}

function cursorOf(attempt: Attempt): AttemptCursor {
	return { writtenAt: attempt.writtenAt, id: attempt.id };
}

/**
 * Strictly newer in the same `(written_at, id)` order the queries page by.
 * `writtenAt` is always a normalized ISO string, so a string compare is the
 * chronological compare.
 */
function isAfter(a: AttemptCursor, b: AttemptCursor): boolean {
	if (a.writtenAt !== b.writtenAt) return a.writtenAt > b.writtenAt;
	return a.id > b.id;
}

export function useAttempts(): AttemptsApi {
	const { pg } = useDb();
	const { revision } = useImport();
	const { mode, fileStem, scenarioHash, latestSeen } = useSelection();

	/* ------------------------------------------------------------------ */
	/* Concern 1: scenario options                                         */
	/* ------------------------------------------------------------------ */

	const scenarios = shallowRef<ScenarioOption[]>([]);
	const scenariosReady = ref(false);
	const scenariosError = ref<string | null>(null);
	let scenarioGen = 0;

	async function loadScenarios(): Promise<void> {
		const handle = pg.value;
		const gen = ++scenarioGen;
		if (handle === null) return;
		try {
			const rows = await listScenarios(handle);
			if (gen !== scenarioGen) return;
			scenarios.value = rows;
			scenariosError.value = null;
			scenariosReady.value = true;
		} catch (err) {
			if (gen !== scenarioGen) return;
			scenariosError.value = errorText(err);
		}
	}

	const filterState = computed<FilterState>(() => {
		const hash = scenarioHash.value;
		if (hash === null) return 'all';
		if (!scenariosReady.value) return 'pending';
		return scenarios.value.some((option) => option.hash === hash) ? 'known' : 'unknown';
	});

	const scenarioId = computed<number | null>(() => {
		const hash = scenarioHash.value;
		if (hash === null) return null;
		return scenarios.value.find((option) => option.hash === hash)?.id ?? null;
	});

	/* ------------------------------------------------------------------ */
	/* Concern 2: the rail page                                            */
	/* ------------------------------------------------------------------ */

	const items = shallowRef<Attempt[]>([]);
	const railState = ref<LoadState>('idle');
	const railError = ref<string | null>(null);
	const cursor = shallowRef<AttemptCursor | null>(null);
	const loadingOlder = ref(false);
	/** How many pages the rail currently shows, so a refresh re-fetches them. */
	let pagesLoaded = 1;
	let railGen = 0;

	const hasMore = computed(() => cursor.value !== null);
	const hasNewer = ref(false);

	/**
	 * The only writer of the rail's committed page. List, cursor and page count
	 * are one fact about one result set, so they are written together and the
	 * count is derived from what was actually committed — a refresh and a
	 * `Load older` that interleave cannot leave it describing a different list
	 * than `items` holds.
	 */
	function commitRail(rows: Attempt[], next: AttemptCursor | null, pages: number): void {
		items.value = rows;
		cursor.value = next;
		pagesLoaded = pages;
		railError.value = null;
	}

	/**
	 * The head of a freshly loaded first page is the newest eligible attempt.
	 * Following keeps the baseline pinned to it, so nothing can look newer;
	 * inspecting compares against the baseline taken when inspection started.
	 * Backfilled older imports and perf-only updates leave `(writtenAt, id)`
	 * unchanged, so neither of them reads as a newer attempt. Report counts and
	 * database ids are never consulted here.
	 */
	function observeHead(head: Attempt | null): void {
		if (head === null) {
			latestSeen.value = null;
			hasNewer.value = false;
			return;
		}
		const current = cursorOf(head);
		if (mode.value === 'follow' || latestSeen.value === null) {
			latestSeen.value = current;
			hasNewer.value = false;
			return;
		}
		hasNewer.value = isAfter(current, latestSeen.value);
	}

	async function fetchPages(
		handle: PGliteInterface,
		scoped: number | null,
		pages: number,
		gen: number,
	): Promise<{ items: Attempt[]; next: AttemptCursor | null; pages: number } | null> {
		const collected: Attempt[] = [];
		let before: AttemptCursor | null = null;
		let loaded = 0;
		for (let index = 0; index < pages; index += 1) {
			const page: { items: Attempt[]; next: AttemptCursor | null } = await listAttempts(
				handle,
				scoped,
				before,
			);
			if (gen !== railGen) return null;
			collected.push(...page.items);
			loaded += 1;
			before = page.next;
			if (before === null) break;
		}
		return { items: collected, next: before, pages: loaded };
	}

	/** The refresh currently in flight, so a discarded `Load older` can wait it out. */
	let railPass: Promise<void> | null = null;

	/** Every refresh goes through here, so `railPass` always names the live one. */
	function refreshRail(keepPages: boolean): Promise<void> {
		const pass = loadRail(keepPages).finally(() => {
			if (railPass === pass) railPass = null;
		});
		railPass = pass;
		return pass;
	}

	/**
	 * `keepPages` re-fetches every page the rail already shows and replaces the
	 * list with the result, so a commit refreshes loaded older rows in place
	 * instead of appending a second copy of them.
	 */
	async function loadRail(keepPages: boolean): Promise<void> {
		const handle = pg.value;
		const gen = ++railGen;
		if (handle === null) {
			railState.value = 'idle';
			return;
		}
		const filter = filterState.value;
		if (filter === 'pending') {
			railState.value = 'loading';
			return;
		}
		if (filter === 'unknown') {
			// Show nothing rather than silently widening to every scenario.
			commitRail([], null, 1);
			railState.value = 'ready';
			return;
		}
		const pages = keepPages ? pagesLoaded : 1;
		railState.value = 'loading';
		try {
			const result = await fetchPages(handle, scenarioId.value, pages, gen);
			if (result === null) return;
			commitRail(result.items, result.next, result.pages);
			railState.value = 'ready';
			observeHead(result.items[0] ?? null);
		} catch (err) {
			if (gen !== railGen) return;
			railError.value = errorText(err);
			railState.value = 'error';
		}
	}

	/**
	 * `retry` is spent on the one thing that can legitimately discard a resolved
	 * page: a refresh that committed while it was in flight. Discarding it is
	 * correct — it was paged against a list that no longer exists — but simply
	 * dropping it leaves the button looking dead, so the click is re-dispatched
	 * once, after that refresh has committed, from the cursor it left behind.
	 * Waiting is what makes the retry contiguous: paging from the old cursor
	 * against a list whose head has moved would leave a hole in the rail.
	 */
	async function fetchOlder(retry: boolean): Promise<void> {
		const handle = pg.value;
		const before = cursor.value;
		if (handle === null || before === null) return;
		const gen = railGen;
		try {
			const page = await listAttempts(handle, scenarioId.value, before);
			if (gen !== railGen) {
				if (!retry) return;
				if (railPass !== null) await railPass;
				await fetchOlder(false);
				return;
			}
			const known = new Set(items.value.map((attempt) => attempt.fileStem));
			commitRail(
				[...items.value, ...page.items.filter((row) => !known.has(row.fileStem))],
				page.next,
				pagesLoaded + 1,
			);
		} catch (err) {
			if (gen !== railGen) return;
			railError.value = errorText(err);
		}
	}

	async function loadOlder(): Promise<void> {
		if (loadingOlder.value) return;
		loadingOlder.value = true;
		try {
			await fetchOlder(true);
		} finally {
			loadingOlder.value = false;
		}
	}

	/* ------------------------------------------------------------------ */
	/* Concern 3: the selected attempt                                     */
	/* ------------------------------------------------------------------ */

	const selected = shallowRef<Attempt | null>(null);
	const selectionState = ref<SelectionState>('idle');
	const selectionError = ref<string | null>(null);
	let selectionGen = 0;
	/** The stem `selected` was last resolved for; `null` while following. */
	let resolvedStem: string | null = null;

	/**
	 * An import pass that wrote rows re-reads the selection. Flipping to
	 * `loading` each time would blank the result the user is reading, so a refresh of the *same*
	 * selection keeps the resolved summary on screen while it is in flight. A
	 * different stem still shows the loading line: continuing to render the
	 * previous attempt under a link that names another one would be showing the
	 * wrong run.
	 */
	function beginSelectionLoad(stem: string | null): void {
		if (selected.value !== null && resolvedStem === stem) return;
		selectionState.value = 'loading';
	}

	/**
	 * An inspected attempt is fetched by its own identity, never taken from the
	 * rail page, so a deep link resolves even when its row is far outside the
	 * loaded page — and even when the filter does not cover it. A link that
	 * resolves to nothing becomes `missing`; no other run is substituted.
	 */
	async function loadSelection(): Promise<void> {
		const handle = pg.value;
		const gen = ++selectionGen;
		if (handle === null) {
			selectionState.value = 'idle';
			return;
		}
		const filter = filterState.value;
		const stem = fileStem.value;
		if (filter === 'pending' && stem === null) {
			// Following: which attempt is latest depends on the unresolved hash.
			beginSelectionLoad(stem);
			return;
		}
		beginSelectionLoad(stem);
		try {
			if (stem !== null) {
				const attempt = await getAttempt(handle, stem);
				if (gen !== selectionGen) return;
				selected.value = attempt;
				resolvedStem = stem;
				selectionState.value = attempt === null ? 'missing' : 'ready';
			} else if (filter === 'unknown') {
				selected.value = null;
				resolvedStem = null;
				selectionState.value = 'empty';
			} else {
				const attempt = await getLatestAttempt(handle, scenarioId.value);
				if (gen !== selectionGen) return;
				selected.value = attempt;
				resolvedStem = null;
				selectionState.value = attempt === null ? 'empty' : 'ready';
			}
			selectionError.value = null;
		} catch (err) {
			if (gen !== selectionGen) return;
			selectionError.value = errorText(err);
			selectionState.value = 'error';
		}
	}

	const selectionOutsideFilter = computed(() => {
		const attempt = selected.value;
		if (attempt === null || fileStem.value === null) return false;
		if (filterState.value === 'unknown') return true;
		const scoped = scenarioId.value;
		return scoped !== null && attempt.scenarioId !== scoped;
	});

	const selectionOffPage = computed(() => {
		const attempt = selected.value;
		if (attempt === null || fileStem.value === null) return false;
		if (railState.value !== 'ready') return false;
		return !items.value.some((row) => row.fileStem === attempt.fileStem);
	});

	/* ------------------------------------------------------------------ */
	/* Wiring                                                              */
	/* ------------------------------------------------------------------ */

	watch(
		[pg, revision],
		() => {
			void loadScenarios();
		},
		{ immediate: true },
	);

	watch(
		[pg, filterState, scenarioId],
		() => {
			void refreshRail(false);
		},
		{ immediate: true },
	);

	watch(
		[pg, fileStem, filterState, scenarioId],
		() => {
			void loadSelection();
		},
		{ immediate: true },
	);

	// Every import pass that wrote rows bumps `revision`, including a partly committed
	// failed one, so this is also how the available committed summaries come
	// back after a partial failure. In inspection mode `loadSelection` re-reads
	// the same stem, which refreshes `hasPerf` without moving the selection; in
	// following mode it re-reads the filter's latest, which is the only way the
	// selection advances.
	watch(revision, () => {
		void refreshRail(true);
		void loadSelection();
	});

	watch(mode, (current) => {
		if (current !== 'follow') return;
		hasNewer.value = false;
		const head = items.value[0];
		latestSeen.value = head === undefined ? null : cursorOf(head);
	});

	return {
		scenarios,
		scenariosError,
		filterState,
		scenarioId,
		items,
		railState,
		railError,
		hasMore,
		loadingOlder,
		loadOlder,
		selected,
		selectionState,
		selectionError,
		selectionOutsideFilter,
		selectionOffPage,
		hasNewer,
		retry: () => {
			void loadScenarios();
			void refreshRail(true);
			void loadSelection();
		},
	};
}
