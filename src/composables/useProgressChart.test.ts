import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, ref, shallowRef, type Ref } from 'vue';
import benchmarksJson from '../data/benchmarks.json';
import snapshotJson from '../data/demo-snapshot.json';
import { candidates } from '../lib/benchmarks/pick';
import type { Snapshot } from '../lib/benchmarks/snapshot';
import { DEMO_SCENARIO_HASH, type DemoSnapshot, snapshotSource } from '../lib/demo/snapshot';
import { rollingMedian } from '../lib/scenario/series';
import { useProgressChart } from './useProgressChart';
import { type ScenarioData, useScenario } from './useScenario';
import { SOURCE_KEY } from './useSource';

/** Loads can outlast vi.waitFor's 1 s default while the whole suite runs. */
const WAIT = { timeout: 10_000 };

const demo = snapshotJson as unknown as DemoSnapshot;

describe('useProgressChart', () => {
	let data: Ref<ScenarioData>;

	beforeAll(async () => {
		const app = createApp({});
		app.provide(SOURCE_KEY, { source: shallowRef(snapshotSource(demo)), revision: ref(0) });
		const api = app.runWithContext(() => effectScope().run(() => useScenario(ref(DEMO_SCENARIO_HASH)))!);
		await vi.waitFor(() => expect(api.state.value).toBe('ready'), WAIT);
		data = ref(api.data.value!) as Ref<ScenarioData>;
	});

	function overall(dateAxis: boolean, formWindow?: number) {
		const name = data.value.scenario.name;
		const bench = candidates(benchmarksJson as unknown as Snapshot, name)[0]!;
		return effectScope().run(() =>
			useProgressChart(data, {
				activeTab: ref(null),
				bots: ref(null),
				bench: ref(bench),
				group: ref(null),
				dateAxis: ref(dateAxis),
				...(formWindow === undefined ? {} : { formWindow: ref(formWindow) }),
			}),
		)!;
	}

	it('plots every run on the Overall tab with the PB step line and median', () => {
		const c = overall(false);
		const scores = data.value.runs.map((r) => r.score);
		expect(c.series.value!.y).toEqual(scores);
		expect(c.x.value).toEqual(scores.map((_, i) => i + 1));
		const best = c.lines.value!.best.filter((v): v is number => v !== null);
		expect(best).toHaveLength(scores.length);
		for (let i = 1; i < best.length; i++) expect(best[i]).toBeGreaterThanOrEqual(best[i - 1]!);
		expect(c.ranks.value?.ranks.length).toBeGreaterThan(0);
		expect(c.breaks.value.length).toBeGreaterThan(0);
	});

	it('puts runs on their dates on the date axis', () => {
		const c = overall(true);
		expect(c.x.value[0]).toBe(new Date(data.value.runs[0]!.startedAt).getTime() / 1000);
	});

	it('explains a run in its tooltip', () => {
		const c = overall(false);
		const first = c.tipFor(0)!;
		expect(first.head).toMatch(/^#1 · /);
		expect(first.rows).toContainEqual({ label: 'vs PB before', value: 'first run' });
		const later = c.tipFor(5)!;
		expect(later.rows.map((r) => r.label)).toEqual(expect.arrayContaining(['time', 'rank', 'vs PB before']));
	});

	it('takes its typical line over the form window N, 10 by default', () => {
		const scores = data.value.runs.map((r) => r.score);
		expect(overall(false).lines.value!.median).toEqual(rollingMedian(scores, 10).value);
		for (const n of [5, 20]) {
			const lines = overall(false, n).lines.value!;
			expect(lines.median).toEqual(rollingMedian(scores, n).value);
			// The lighter first points: the window fills after N scored runs.
			expect(lines.full.indexOf(true)).toBe(n - 1);
		}
		const tip = overall(false, 5).tipFor(10)!;
		expect(tip.rows.map((r) => r.label)).toContain('median of last 5');
	});
});
