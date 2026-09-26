/**
 * The Scenarios directory's data and URL state (L6, L7 of its design).
 * See docs/superpowers/specs/2026-09-26-scenarios-directory-design.md.
 *
 * The rows are read once and reread when an import adds runs. Search and sort
 * live in the route query; the last directory location is remembered in
 * memory, as Run's is, for the header's Scenarios tab.
 */
import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { router } from '../router';
import {
	type DirectoryRow,
	type DirectoryState,
	directoryQuery,
	directoryRows,
	nextSort,
	parseDirectoryQuery,
	type SortKey,
} from '../lib/scenario/directory';
import { listScenarios } from '../lib/scenario/queries';
import { errorText } from '../lib/error';
import { useDb } from './useDb';
import { useImport } from './useImport';

export type DirectoryLoad = 'loading' | 'ready' | 'error';

export interface ScenarioDirectoryApi {
	state: Ref<DirectoryLoad>;
	error: Ref<string | null>;
	/** Every row, unfiltered and unsorted. */
	rows: Ref<DirectoryRow[]>;
	retry: () => void;
}

export function useScenarioDirectory(): ScenarioDirectoryApi {
	const { pg } = useDb();
	const { revision } = useImport();

	const state = ref<DirectoryLoad>('loading');
	const error = ref<string | null>(null);
	const rows = shallowRef<DirectoryRow[]>([]);
	let gen = 0;

	async function load(): Promise<void> {
		const handle = pg.value;
		const mine = ++gen;
		if (handle === null) return;
		try {
			const summaries = await listScenarios(handle);
			if (mine !== gen) return;
			rows.value = directoryRows(summaries);
			state.value = 'ready';
			error.value = null;
		} catch (err) {
			if (mine !== gen) return;
			error.value = errorText(err);
			state.value = 'error';
		}
	}

	watch([pg, revision], () => void load(), { immediate: true });

	return { state, error, rows, retry: () => void load() };
}

export interface DirectoryRouteApi {
	/** The search and sort in the current directory URL. */
	current: ComputedRef<DirectoryState>;
	/** The last directory location visited, for the header. */
	rememberedRoute: ComputedRef<RouteLocationRaw>;
	/** Typing replaces the history entry rather than pushing one. */
	setQ: (q: string) => void;
	setSort: (key: SortKey) => void;
	setBench: (bench: number | null) => void;
}

function create(): DirectoryRouteApi {
	const route = router.currentRoute;
	const current = computed(() => parseDirectoryQuery(route.value.query));

	const remembered = ref<RouteLocationRaw>({ name: 'scenarios' });
	watch(
		route,
		(r) => {
			if (r.name === 'scenarios') remembered.value = { name: 'scenarios', query: directoryQuery(parseDirectoryQuery(r.query)) };
		},
		{ immediate: true },
	);

	function go(next: DirectoryState, replace: boolean): void {
		const to = { name: 'scenarios', query: directoryQuery(next) };
		void (replace ? router.replace(to) : router.push(to));
	}

	return {
		current,
		rememberedRoute: computed(() => remembered.value),
		setQ: (q) => go({ ...current.value, q }, true),
		setSort: (key) => go({ ...current.value, ...nextSort(current.value, key) }, true),
		setBench: (bench) => go({ ...current.value, bench }, true),
	};
}

let api: DirectoryRouteApi | undefined;

/** A module singleton, like `useSelection`, so the remembered location outlives the view. */
export function useDirectoryRoute(): DirectoryRouteApi {
	api ??= create();
	return api;
}

if (import.meta.hot) {
	import.meta.hot.accept(() => import.meta.hot!.invalidate());
}
