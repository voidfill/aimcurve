import { describe, expect, it } from 'vitest';
import { landsOnAbout, SEEN_ABOUT_KEY, shouldShowAbout } from './about';

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

describe('landsOnAbout', () => {
	it('is true on About itself and on a root that will redirect there', () => {
		expect(landsOnAbout('#/about', [SEEN_ABOUT_KEY])).toBe(true);
		expect(landsOnAbout('', [])).toBe(true);
		expect(landsOnAbout('#/', [])).toBe(true);
	});

	it('is false anywhere else', () => {
		expect(landsOnAbout('', [SEEN_ABOUT_KEY])).toBe(false);
		expect(landsOnAbout('#/?run=x', [])).toBe(false);
		expect(landsOnAbout('#/data', [])).toBe(false);
	});
});
