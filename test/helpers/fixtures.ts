import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export type FixtureKind = 'performances' | 'stats';

const extensions: Record<FixtureKind, string> = {
	performances: '.perf',
	stats: '.csv',
};

export interface FixtureSet {
	/** False when the directory is absent — guard suites with `describe.skipIf(!set.available)`. */
	available: boolean;
	dir: string;
	list(kind: FixtureKind): string[];
	text(kind: FixtureKind, name: string): string;
	bytes(kind: FixtureKind, name: string): Uint8Array;
}

function fixtureSet(dir: string): FixtureSet {
	return {
		available: existsSync(dir),
		dir,

		list(kind) {
			const kindDir = join(dir, kind);
			if (!existsSync(kindDir)) return [];
			return readdirSync(kindDir)
				.filter((name) => name.endsWith(extensions[kind]))
				.sort();
		},

		text(kind, name) {
			return readFileSync(join(dir, kind, name), 'utf8');
		},

		bytes(kind, name) {
			const buffer = readFileSync(join(dir, kind, name));
			return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		},
	};
}

/**
 * Hand-picked files, committed to the repo. Everything that has to pass on a
 * fresh clone reads from here.
 */
export const curated = fixtureSet(join(fixturesDir, 'curated'));

/**
 * The full dump, gitignored. Only for sweeps that check a parser against every
 * file we have; always guard on `raw.available`.
 */
export const raw = fixtureSet(join(fixturesDir, 'raw'));
