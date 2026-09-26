/**
 * Whether a visitor lands on About first (D6 of the About design). Pure, so
 * tests can cover it; reading storage is the caller's.
 *
 * A first-time visitor on the bare root sees About, decided before the
 * database opens, so they never wait for it just to be redirected. Deep links
 * are never redirected.
 */

import { START_LOCATION } from 'vue-router';
import { KEY_PREFIX } from './storage';

/** Set once About has been shown. */
export const SEEN_ABOUT_KEY = 'aimcurve.seen-about';


export interface LandingTarget {
	path: string;
	hasQuery: boolean;
}

/**
 * `keys` are the storage keys present, or null when storage cannot be read:
 * then nobody is redirected, and the app behaves as it did before About.
 */
export function shouldShowAbout(target: LandingTarget, keys: readonly string[] | null): boolean {
	if (keys === null) return false;
	if (target.path !== '/' || target.hasQuery) return false;
	// Any aimcurve key marks a returning user.
	return !keys.some((key) => key.startsWith(KEY_PREFIX));
}

/**
 * The router guard's decision: About for a first-time visitor's page load on
 * the bare root, else nothing. Only the load's own navigation (`from` is
 * START_LOCATION): clicking Run later never bounces anyone.
 */
export function firstVisitRedirect(
	to: { path: string; query: object },
	from: unknown,
	keys: readonly string[] | null,
): { name: 'about' } | undefined {
	if (from !== START_LOCATION) return undefined;
	return shouldShowAbout({ path: to.path, hasQuery: Object.keys(to.query).length > 0 }, keys) ? { name: 'about' } : undefined;
}

/** The storage keys present, or null when storage is blocked. */
export function storageKeys(): string[] | null {
	try {
		return Object.keys(localStorage);
	} catch {
		return null;
	}
}

/** Remembers that About was shown; blocked storage just means it shows again. */
export function markAboutSeen(): void {
	try {
		localStorage.setItem(SEEN_ABOUT_KEY, '1');
	} catch {
		// Nothing to do: without storage there is no redirect either.
	}
}
