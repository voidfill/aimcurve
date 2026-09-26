// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { clearOwnKeys } from './storage';

afterEach(() => localStorage.clear());

describe('clearOwnKeys', () => {
	it('removes every aimcurve key and leaves the rest of the origin alone', () => {
		localStorage.setItem('aimcurve.import', '{}');
		localStorage.setItem('aimcurve.run-chart', '{}');
		localStorage.setItem('aimcurve.seen-about', '1');
		// Another app on the same GitHub Pages origin.
		localStorage.setItem('other-project.settings', 'keep');
		localStorage.setItem('aimcurvey', 'keep');

		clearOwnKeys(localStorage);

		expect(Object.keys(localStorage).sort()).toEqual(['aimcurvey', 'other-project.settings']);
	});
});
