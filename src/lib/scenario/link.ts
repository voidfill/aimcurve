/**
 * S1 and S7 of the scenario page design: the version switcher and the
 * Kovaak's deep link. See docs/superpowers/specs/2026-09-25-scenario-page-design.md.
 */
import { formatValue } from '../run/format';

/**
 * Kovaak's 3.0 scenario deep link, in challenge mode: without `mode=challenge`
 * it opens in freeplay. It selects by name, not by hash: Kovaak's opens
 * whatever it currently has under that name.
 */
export function kovaaksLink(name: string): string {
	return `steam://run/824270/?action=jump-to-scenario;name=${encodeURIComponent(name)};mode=challenge`;
}

export interface ScenarioVersion {
	id: number;
	hash: string;
	runs: number;
	/** Normalized ISO timestamp of the latest completed run. */
	lastPlayed: string;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function shortHash(hash: string): string {
	return hash.slice(0, 8);
}

/** `a1b2c3d4 · 42 runs · last 3 Sep 2026`. */
export function versionLabel(v: ScenarioVersion): string {
	return `${shortHash(v.hash)} · ${formatValue(v.runs)} ${v.runs === 1 ? 'run' : 'runs'} · last ${dateFormat.format(new Date(v.lastPlayed))}`;
}

/** Whether `hash` is the version played most recently of those sharing its name. */
export function isNewestVersion(hash: string, versions: readonly ScenarioVersion[]): boolean {
	const newest = [...versions].sort((a, b) => (a.lastPlayed < b.lastPlayed ? 1 : a.lastPlayed > b.lastPlayed ? -1 : 0))[0];
	return newest === undefined || newest.hash === hash;
}
