/**
 * Run selection and filtering, backed by the route query.
 *
 * The URL is the single source of truth for what is selected:
 * `#/?run=<fileStem>&scenario=<hash>`. Absent `run` means Follow latest, a
 * present `run` means inspection. `scenario` carries a scenario *content
 * hash* — unrelated to hash-mode routing despite the shared word — which
 * `useAttempts` resolves to the current scenario id once the options load.
 *
 * There is no `popstate` listener here on purpose. The router's current route
 * is reactive, so Back and Forward are already vue-router's job; a listener of
 * our own would be redundant and would risk a duplicate registration.
 *
 * This is a module singleton, and it reads `router.currentRoute` rather than
 * calling `useRoute()`: it is exactly the same reactive source, but it does not
 * depend on an active component instance, which matters because
 * `rememberedRunRoute` has to outlive every unmount of the Run view.
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { LocationQueryRaw, LocationQueryValue, RouteLocationRaw } from 'vue-router';
import { router } from '../router';
import type { AttemptCursor } from '../lib/run/queries';

export type SelectionMode = 'follow' | 'inspect';

export interface SelectionApi {
	/** `inspect` as soon as a `run` parameter is present. */
	mode: ComputedRef<SelectionMode>;
	/** The inspected attempt's persistent identity, or null while following. */
	fileStem: ComputedRef<string | null>;
	/** The scenario *content hash* from the query, or null for all scenarios. */
	scenarioHash: ComputedRef<string | null>;
	/** Just the filter part of the query, for building links that keep it. */
	filterQuery: ComputedRef<LocationQueryRaw>;
	/**
	 * The newest `(writtenAt, id)` the user has been shown. `useAttempts`
	 * baselines it and compares against it; it lives here because it has to
	 * survive the Run view unmounting on a trip to Data.
	 */
	latestSeen: Ref<AttemptCursor | null>;
	/** The last Run location visited, for the header and the Data page's Back to Run. */
	rememberedRunRoute: ComputedRef<RouteLocationRaw>;
	/** The link an attempt row points at: selection plus the current filter. */
	linkTo: (stem: string) => RouteLocationRaw;
	/** Programmatic equivalent of following an attempt link. */
	selectAttempt: (stem: string) => void;
	/** Drop the inspection, resume following, clear the new-attempt indicator. */
	resumeLatest: () => void;
	/** Follow a link into Run that follows latest: a plain click re-baselines the newest run. */
	followLatest: (event: MouseEvent, navigate: (e?: MouseEvent) => unknown) => void;
	setFilter: (hash: string | null) => void;
}

function single(value: LocationQueryValue | LocationQueryValue[] | undefined): string | null {
	const first = Array.isArray(value) ? value[0] : value;
	return typeof first === 'string' && first.length > 0 ? first : null;
}

function create(): SelectionApi {
	const route = router.currentRoute;

	const fileStem = computed(() => single(route.value.query.run));
	const scenarioHash = computed(() => single(route.value.query.scenario));
	const mode = computed<SelectionMode>(() => (fileStem.value === null ? 'follow' : 'inspect'));

	const filterQuery = computed<LocationQueryRaw>(() =>
		scenarioHash.value === null ? {} : { scenario: scenarioHash.value },
	);

	const latestSeen = ref<AttemptCursor | null>(null);

	/**
	 * In memory only, and deliberately so: a freshly opened document at `#/`
	 * follows latest instead of resurrecting a previous session's inspection.
	 * The watcher records whatever Run URL is actually current, so a directly
	 * opened Run URL always takes precedence over what was remembered.
	 */
	const remembered = ref<{ path: string; query: LocationQueryRaw }>({ path: '/', query: {} });
	watch(
		route,
		(current) => {
			if (current.name === 'run') remembered.value = { path: '/', query: { ...current.query } };
		},
		{ immediate: true },
	);
	const rememberedRunRoute = computed<RouteLocationRaw>(() => remembered.value);

	function linkTo(stem: string): RouteLocationRaw {
		return { path: '/', query: { run: stem, ...filterQuery.value } };
	}

	return {
		mode,
		fileStem,
		scenarioHash,
		filterQuery,
		latestSeen,
		rememberedRunRoute,
		linkTo,
		// `push`, not `replace`: inspecting is a place you can go Back from, and
		// it pauses following even when the target happens to be the newest run.
		selectAttempt: (stem: string) => {
			void router.push(linkTo(stem));
		},
		// A plain click on a link into Run that follows latest in a new filter: the
		// newest run there is re-baselined. A modified click (a new tab) leaves this
		// tab's following alone.
		followLatest: (event: MouseEvent, navigate: (e?: MouseEvent) => unknown) => {
			if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) latestSeen.value = null;
			navigate(event);
		},
		// `replace`: resuming is undoing a selection, not a new place.
		resumeLatest: () => {
			latestSeen.value = null;
			void router.replace({ path: '/', query: { ...filterQuery.value } });
		},
		setFilter: (hash: string | null) => {
			const query: LocationQueryRaw = {};
			// Inspection survives a filter change; only the filter part moves.
			const stem = fileStem.value;
			if (stem !== null) query.run = stem;
			if (hash !== null) query.scenario = hash;
			// A different filter has a different newest run: re-baseline.
			latestSeen.value = null;
			void router.push({ path: '/', query });
		},
	};
}

let api: SelectionApi | undefined;

export function useSelection(): SelectionApi {
	api ??= create();
	return api;
}

if (import.meta.hot) {
	// Re-running this module would leave the previous route watcher registered
	// beside the new one. Escalate to a full reload instead.
	import.meta.hot.accept(() => import.meta.hot!.invalidate());
}
