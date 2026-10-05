/**
 * Settings shared by the scenario and Benchmarks pages, each persisted per
 * browser: the chart's x axis (S5), the run window, and the Benchmarks page's
 * coverage mode.
 *
 * VueUse keeps every `useStorage` of one key in step within the document, so
 * changing a setting on either page changes it on both. No storage argument:
 * VueUse resolves `localStorage` inside a try, where naming the global here
 * would throw outright when site data is blocked.
 */
import { computed, type WritableComputedRef } from 'vue';
import { useStorage } from '@vueuse/core';
import type { CoverageMode } from '../lib/arc/aggregate';

/** One stored setting, read back as the default when storage holds anything else. */
function choice<T extends string | number>(key: string, options: readonly T[], fallback: T): WritableComputedRef<T> {
	const stored = useStorage<T>(key, fallback);
	return computed({
		get: () => (options.includes(stored.value) ? stored.value : fallback),
		set: (value) => {
			stored.value = value;
		},
	});
}

export type ChartAxis = 'attempt' | 'date';

/** The progression charts' x axis, shared by both pages. */
export function useChartAxis(): WritableComputedRef<ChartAxis> {
	return choice<ChartAxis>('aimcurve.scenario-axis', ['attempt', 'date'], 'attempt');
}

export const RUN_WINDOWS = [5, 10, 20, 50] as const;

/**
 * How many of a scenario's latest complete runs count as recent: form (the
 * charts' median line and form arc), the candle and the median pill all
 * take that many. One setting where the spec had two (`N` for form, `W` for
 * the candle); 10 by default, so the scenario page looks as it always has.
 */
export function useRunWindow(): WritableComputedRef<number> {
	return choice<number>('aimcurve.form-window', RUN_WINDOWS, 10);
}

/** Provisional (the default) or strict coverage. */
export function useCoverageMode(): WritableComputedRef<CoverageMode> {
	return choice<CoverageMode>('aimcurve.benchmark-coverage', ['provisional', 'strict'], 'provisional');
}
