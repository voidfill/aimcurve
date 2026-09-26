/**
 * Whether a visitor lands on About first (D6 of the About design). Pure, so
 * tests can cover it; reading storage is the caller's.
 *
 * A first-time visitor on the bare root sees About, decided before the
 * database opens, so they never wait for it just to be redirected. Deep links
 * are never redirected.
 */

/** Set once About has been shown. */
export const SEEN_ABOUT_KEY = 'aimcurve.seen-about';

/** Every aimcurve setting shares it, so any of them marks a returning user. */
const KEY_PREFIX = 'aimcurve.';

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
	return !keys.some((key) => key.startsWith(KEY_PREFIX));
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
