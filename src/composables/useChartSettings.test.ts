// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { useCandleWindow, useChartAxis, useCoverageMode, useFormWindow } from './useChartSettings';

describe('P13 shared settings', () => {
	beforeEach(() => localStorage.clear());

	it('reads one stored form window from both pages', async () => {
		const [scenarioPage, benchmarkPage] = effectScope().run(() => [useFormWindow(), useFormWindow()])!;
		expect(scenarioPage.value).toBe(10);
		benchmarkPage.value = 20;
		await nextTick();
		expect(scenarioPage.value).toBe(20);
		expect(localStorage.getItem('aimcurve.form-window')).toBe('20');
	});

	it('falls back to the defaults when storage holds something else', () => {
		localStorage.setItem('aimcurve.form-window', '7');
		localStorage.setItem('aimcurve.benchmark-window', 'x');
		localStorage.setItem('aimcurve.benchmark-coverage', 'loose');
		const [form, candle, mode, axis] = effectScope().run(() => [useFormWindow(), useCandleWindow(), useCoverageMode(), useChartAxis()])!;
		expect(form.value).toBe(10);
		expect(candle.value).toBe(20);
		expect(mode.value).toBe('provisional');
		expect(axis.value).toBe('attempt');
	});

	it('shares the x axis with the scenario page’s stored key', () => {
		localStorage.setItem('aimcurve.scenario-axis', 'date');
		expect(effectScope().run(() => useChartAxis())!.value).toBe('date');
	});
});
