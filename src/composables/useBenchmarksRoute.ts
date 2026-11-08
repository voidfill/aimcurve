/**
 * The last Benchmarks locations, kept in memory as Scenarios' and Run's are:
 * `tab`, for the header's tab, is the index or the difficulty last open;
 * `index` is the index with its last search, for the ways back up to it.
 */
import { computed, type ComputedRef, ref, watch } from 'vue';
import type { LocationQuery, RouteLocationRaw } from 'vue-router';
import { router } from '../router';

export interface BenchmarksRouteApi {
	tab: ComputedRef<RouteLocationRaw>;
	index: ComputedRef<RouteLocationRaw>;
	/** The index's search in the current URL. */
	q: ComputedRef<string>;
	/** Typing replaces the history entry rather than pushing one. */
	setQ: (q: string) => void;
}

function queryOf(q: string): LocationQuery {
	return q.trim() === '' ? {} : { q };
}

function create(): BenchmarksRouteApi {
	const route = router.currentRoute;
	const index = ref<RouteLocationRaw>({ name: 'benchmarks' });
	const tab = ref<RouteLocationRaw>(index.value);
	const q = computed(() => {
		const v = route.value.query.q;
		return typeof v === 'string' ? v : '';
	});
	watch(
		route,
		(r) => {
			if (r.name === 'benchmarks') tab.value = index.value = { name: 'benchmarks', query: queryOf(q.value) };
			else if (r.name === 'benchmark') tab.value = { name: 'benchmark', params: { id: String(r.params.id) } };
		},
		{ immediate: true },
	);
	return {
		tab: computed(() => tab.value),
		index: computed(() => index.value),
		q,
		setQ: (next) => void router.replace({ name: 'benchmarks', query: queryOf(next) }),
	};
}

let api: BenchmarksRouteApi | undefined;

/** A module singleton, like `useDirectoryRoute`, so the remembered locations outlive the view. */
export function useBenchmarksRoute(): BenchmarksRouteApi {
	api ??= create();
	return api;
}

if (import.meta.hot) {
	import.meta.hot.accept(() => import.meta.hot!.invalidate());
}
