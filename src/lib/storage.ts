/**
 * aimcurve's localStorage keys. Storage is shared by the whole origin, and on
 * GitHub Pages that origin (`voidfill.github.io`) is shared by every project
 * hosted there, so aimcurve only ever touches keys under its own prefix and
 * never calls `clear()`.
 */

/** Every aimcurve key starts with this. */
export const KEY_PREFIX = 'aimcurve.';

/** Removes every aimcurve key, and nothing else on the origin. */
export function clearOwnKeys(storage: Storage): void {
	// Collected first: removing while indexing would skip keys.
	const own: string[] = [];
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i);
		if (key?.startsWith(KEY_PREFIX)) own.push(key);
	}
	for (const key of own) storage.removeItem(key);
}
