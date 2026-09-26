/**
 * The demo run's pace chart and bot table, as About and the link-preview card
 * draw them: the Run view's own composables with fixed settings, the
 * PB-before baseline, and a private benchmark pick so nothing is written.
 *
 * Reads the snapshot source a parent component provides.
 */
import { computed, ref, type Ref } from 'vue';
import type { ChartLayers } from '../UnifiedChart.vue';
import { useBenchmarkRank } from '../../composables/useBenchmarkRank';
import { useRunAnalysis } from '../../composables/useRunAnalysis';
import { useRunCharts } from '../../composables/useRunCharts';
import type { BaselineOption } from '../../lib/run/baseline';
import type { Attempt } from '../../lib/run/queries';

const LAYERS: ChartLayers = { local: true, accumulated: true, baseline: true, baseLocal: false, recent: false, ranks: true };

export function useDemoRun(attempt: Ref<Attempt>) {
	const { state, analysis, baseline, retry } = useRunAnalysis(
		computed<Attempt | null>(() => attempt.value),
		ref<BaselineOption>('pb-before'),
	);
	const bench = useBenchmarkRank(
		computed(() => attempt.value.scenarioName),
		computed(() => attempt.value.score),
		{ picks: ref({}) },
	);
	const charts = useRunCharts(analysis, baseline, bench, { layers: ref(LAYERS), window: ref(5) });
	return { state, retry, bench, charts };
}
