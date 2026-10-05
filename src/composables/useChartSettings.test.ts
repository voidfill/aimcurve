// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { useChartAxis, useCoverageMode, useRunWindow } from './useChartSettings';

describe('shared settings', () => {
	beforeEach(() => localStorage.clear());

	it('reads one stored run window from both pages', async () => {
		const [scenarioPage, benchmarkPage] = effectScope().run(() => [useRunWindow(), useRunWindow()])!;
		expect(scenarioPage.value).toBe(10);
		benchmarkPage.value = 50;
		await nextTick();
		expect(scenarioPage.value).toBe(50);
		expect(localStorage.getItem('aimcurve.form-window')).toBe('50');
	});

	it('falls back to the defaults when storage holds something else', () => {
		localStorage.setItem('aimcurve.form-window', '7');
		localStorage.setItem('aimcurve.benchmark-coverage', 'loose');
		const [runs, mode, axis] = effectScope().run(() => [useRunWindow(), useCoverageMode(), useChartAxis()])!;
		expect(runs.value).toBe(10);
		expect(mode.value).toBe('provisional');
		expect(axis.value).toBe('attempt');
	});

	it('shares the x axis with the scenario page’s stored key', () => {
		localStorage.setItem('aimcurve.scenario-axis', 'date');
		expect(effectScope().run(() => useChartAxis())!.value).toBe('date');
	});
});
