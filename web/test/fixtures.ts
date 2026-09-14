import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The fixtures live with the Python, one level up, because both implementations
// are checked against the same files. See the repository-split spec: there is
// no boundary here to reach across.
// fileURLToPath rather than .pathname: a URL's pathname is percent-encoded, so
// a checkout under a path with a space in it resolves to a literal "%20" and
// every fixture read fails with ENOENT. The target users are Windows players,
// where a space in the path is the normal case rather than the odd one.
export const FIXTURES = fileURLToPath(new URL('../../tests/fixtures/', import.meta.url));

export const statsDir = join(FIXTURES, 'stats');
export const perfDir = join(FIXTURES, 'performances');

/** Every stats basename, without the " Stats.csv" suffix. */
export function statsIds(): string[] {
  return readdirSync(statsDir)
    .filter((n) => n.endsWith(' Stats.csv'))
    .map((n) => n.slice(0, -' Stats.csv'.length))
    .sort();
}

export function readStats(id: string): string {
  return readFileSync(join(statsDir, `${id} Stats.csv`), 'utf8');
}

/** The `.perf` bytes for a run, or undefined for the ~1-in-7 that have none. */
export function readPerf(id: string): Uint8Array | undefined {
  try {
    return new Uint8Array(readFileSync(join(perfDir, `${id} Performance.perf`)));
  } catch {
    return undefined;
  }
}

/** The truncated fixture, which lives outside performances/ so no bootstrap
 *  picks it up as a real run. */
export function readTruncatedPerf(): Uint8Array {
  return new Uint8Array(
    readFileSync(join(FIXTURES, 'truncated - Challenge - 2026.01.01-00.00.00 Performance.perf')));
}
