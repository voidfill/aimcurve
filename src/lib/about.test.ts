import { describe, expect, it } from 'vitest';
import { START_LOCATION } from 'vue-router';
import { firstVisitRedirect, SEEN_ABOUT_KEY, shouldShowAbout } from './about';

const root = { path: '/', hasQuery: false };

describe('shouldShowAbout', () => {
	it('sends a first-time visitor on the bare root to About', () => {
		expect(shouldShowAbout(root, [])).toBe(true);
		expect(shouldShowAbout(root, ['someone.else'])).toBe(true);
	});

	it('leaves a visitor who has seen About where they are', () => {
		expect(shouldShowAbout(root, [SEEN_ABOUT_KEY])).toBe(false);
	});

	it('treats any earlier aimcurve setting as a returning user', () => {
		expect(shouldShowAbout(root, ['aimcurve.run-chart'])).toBe(false);
	});

	it('never redirects a deep link', () => {
		expect(shouldShowAbout({ path: '/', hasQuery: true }, [])).toBe(false);
		expect(shouldShowAbout({ path: '/data', hasQuery: false }, [])).toBe(false);
		expect(shouldShowAbout({ path: '/scenario/abc', hasQuery: false }, [])).toBe(false);
	});

	it('does not redirect when storage cannot be read', () => {
		expect(shouldShowAbout(root, null)).toBe(false);
	});
});

describe('firstVisitRedirect', () => {
	const at = (path: string, query: Record<string, string> = {}) => ({ path, query });

	it('redirects only the page load’s own navigation', () => {
		expect(firstVisitRedirect(at('/'), START_LOCATION, [])).toEqual({ name: 'about' });
		expect(firstVisitRedirect(at('/'), at('/data'), [])).toBeUndefined();
	});

	it('leaves a root carrying a query alone', () => {
		expect(firstVisitRedirect(at('/', { run: 'x' }), START_LOCATION, [])).toBeUndefined();
	});

	it('leaves a returning visitor alone', () => {
		expect(firstVisitRedirect(at('/'), START_LOCATION, ['aimcurve.run-chart'])).toBeUndefined();
	});
});
