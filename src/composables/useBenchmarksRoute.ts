/**
 * The last Benchmarks location, for the header's tab (P12 of the benchmarks
 * page design): the index, or the difficulty last open. Kept in memory, as
 * Scenarios' and Run's are.
 */
import { computed, type ComputedRef, ref, watch } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { router } from '../router';

function create(): ComputedRef<RouteLocationRaw> {
	const remembered = ref<RouteLocationRaw>({ name: 'benchmarks' });
	watch(
		router.currentRoute,
		(r) => {
			if (r.name === 'benchmarks') remembered.value = { name: 'benchmarks' };
			else if (r.name === 'benchmark') remembered.value = { name: 'benchmark', params: { id: String(r.params.id) } };
		},
		{ immediate: true },
	);
	return computed(() => remembered.value);
}

let api: ComputedRef<RouteLocationRaw> | undefined;

/** A module singleton, like `useDirectoryRoute`, so the remembered location outlives the view. */
export function useBenchmarksRoute(): ComputedRef<RouteLocationRaw> {
	api ??= create();
	return api;
}

if (import.meta.hot) {
	import.meta.hot.accept(() => import.meta.hot!.invalidate());
}
