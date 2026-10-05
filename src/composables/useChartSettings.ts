/**
 * Settings shared by the scenario and Benchmarks pages, each persisted per
 * browser: the chart's x axis (S5), the form window (P13 of the benchmarks
 * page design), and the Benchmarks page's candle window and coverage mode.
 *
 * VueUse keeps every `useStorage` of one key in step within the document, so
 * changing a setting on either page changes it on both. No storage argument:
 * VueUse resolves `localStorage` inside a try, where naming the global here
 * would throw outright when site data is blocked.
 */
import { computed, type WritableComputedRef } from 'vue';
import { useStorage } from '@vueuse/core';
import type { CoverageMode } from '../lib/energy/aggregate';

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

export const FORM_WINDOWS = [5, 10, 20] as const;

/** `N`: form is the median of a scenario's last `N` complete runs. */
export function useFormWindow(): WritableComputedRef<number> {
	return choice<number>('aimcurve.form-window', FORM_WINDOWS, 10);
}

export const CANDLE_WINDOWS = [10, 20, 50] as const;

/** `W`: the candle and the median pill take a scenario's last `W` complete runs. */
export function useCandleWindow(): WritableComputedRef<number> {
	return choice<number>('aimcurve.benchmark-window', CANDLE_WINDOWS, 20);
}

/** Provisional (the default) or strict coverage (E4). */
export function useCoverageMode(): WritableComputedRef<CoverageMode> {
	return choice<CoverageMode>('aimcurve.benchmark-coverage', ['provisional', 'strict'], 'provisional');
}
