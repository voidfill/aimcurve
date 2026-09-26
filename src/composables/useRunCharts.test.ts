import { describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, ref, shallowRef } from 'vue';
import snapshotJson from '../data/demo-snapshot.json';
import type { ChartLayers } from '../components/UnifiedChart.vue';
import type { Encounter } from '../lib/run/bots';
import { DEMO_RUN_STEM, type DemoSnapshot, snapshotSource } from '../lib/demo/snapshot';
import type { Attempt } from '../lib/run/queries';
import { useBenchmarkRank } from './useBenchmarkRank';
import { useRunAnalysis } from './useRunAnalysis';
import { useRunCharts } from './useRunCharts';
import { SOURCE_KEY } from './useSource';

/** Loads can outlast vi.waitFor's 1 s default while the whole suite runs. */
const WAIT = { timeout: 10_000 };

const snapshot = snapshotJson as unknown as DemoSnapshot;
const attempt = snapshot.attempts[DEMO_RUN_STEM]!;
const LAYERS: ChartLayers = { local: true, accumulated: true, baseline: true, baseLocal: false, recent: false, ranks: true };

async function setup() {
	const app = createApp({});
	app.provide(SOURCE_KEY, { source: shallowRef(snapshotSource(snapshot)), revision: ref(0) });
	return app.runWithContext(async () => {
		const scope = effectScope();
		const { analysis, baseline, state } = scope.run(() => useRunAnalysis(ref<Attempt | null>(attempt), ref('pb-before')))!;
		const bench = scope.run(() => useBenchmarkRank(ref(attempt.scenarioName), ref(attempt.score), { picks: ref({}) }))!;
		const charts = scope.run(() => useRunCharts(analysis, baseline, bench, { layers: ref(LAYERS), window: ref(5) }))!;
		await vi.waitFor(() => expect(state.value).toBe('ready'), WAIT);
		await vi.waitFor(() => expect(bench.selected.value).not.toBeNull(), WAIT);
		return { charts, baseline };
	});
}

describe('useRunCharts', () => {
	it('assembles the chart, bot table and rank bands for the demo run', async () => {
		const { charts, baseline } = await setup();
		expect(charts.chart.value).not.toBeNull();
		expect(charts.layers.value).toEqual(LAYERS);
		expect(charts.table.value?.kind).toBe(charts.race.value ? 'race' : 'clock');
		expect(charts.spans.value.length).toBeGreaterThan(0);
		expect(charts.colors.value.size).toBe(new Set(charts.spans.value.map((e) => e.bot)).size);
		expect(charts.chartRanks.value?.ranks.length).toBeGreaterThan(0);
		// The story About tells: ahead of the PB-before mid-run, behind at the end.
		expect(baseline.value!.kind).toBe('charted');
		expect(charts.readoutAt.value!(0.46)).toBeGreaterThan(0);
		expect(charts.readoutAt.value!(1)).toBeLessThan(0);
	});

	it('highlights a pinned bot, and a hovered one over it', async () => {
		const { charts } = await setup();
		// Table rows are keyed by kill slot in a race and by bot otherwise.
		const keyOf = (e: Encounter) => (charts.race.value ? String(e.index) : e.bot);
		const keys = [...new Set(charts.spans.value.map(keyOf))];
		const [first, second] = keys;
		expect(charts.highlight.value).toBeNull();

		charts.toggle(first!);
		expect(charts.highlight.value!.every((e) => keyOf(e) === first)).toBe(true);
		expect(charts.highlight.value!.length).toBeGreaterThan(0);

		charts.hovered.value = second!;
		expect(charts.highlight.value!.every((e) => keyOf(e) === second)).toBe(true);

		charts.hovered.value = null;
		charts.toggle(first!);
		expect(charts.highlight.value).toBeNull();
	});
});
