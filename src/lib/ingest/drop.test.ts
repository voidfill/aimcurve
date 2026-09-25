import { describe, expect, it } from 'vitest';
import { dragHasFiles, filesFromEntries, type DropEntry } from './drop';

function file(name: string): DropEntry {
	return {
		name,
		isFile: true,
		isDirectory: false,
		file: (success: (f: File) => void) => success(new File(['x'], name)),
	} as DropEntry;
}

/** A directory whose reader hands back `batch` entries per call, like Chromium's 100. */
function dir(name: string, children: DropEntry[], batch = 100): DropEntry {
	return {
		name,
		isFile: false,
		isDirectory: true,
		createReader() {
			let at = 0;
			return {
				readEntries(success: (entries: DropEntry[]) => void) {
					const next = children.slice(at, at + batch);
					at += next.length;
					success(next);
				},
			};
		},
	} as DropEntry;
}

const STATS = 'Tile Frenzy - 2026.01.01-10.00.00 Stats.csv';
const PERF = 'Tile Frenzy - 2026.01.01-10.00.00 Performance.perf';

describe('filesFromEntries', () => {
	it('keeps loose stats and perf files and drops everything else', async () => {
		const files = await filesFromEntries([file(STATS), file(PERF), file('notes.txt')]);
		expect(files.map((f) => f.name)).toEqual([STATS, PERF]);
	});

	it('walks nested folders', async () => {
		const root = dir('FPSAimTrainer', [dir('stats', [file(STATS)]), dir('performances', [file(PERF)])]);
		const files = await filesFromEntries([root]);
		expect(files.map((f) => f.name)).toEqual([STATS, PERF]);
	});

	it('reads every batch of a folder bigger than one batch', async () => {
		const many = Array.from({ length: 7 }, (_, i) => file(`S${i} - 2026.01.01-10.00.0${i} Stats.csv`));
		const files = await filesFromEntries([dir('stats', many, 3)]);
		expect(files).toHaveLength(7);
	});
});

describe('dragHasFiles', () => {
	it('is true only for a drag carrying files', () => {
		expect(dragHasFiles(['Files'])).toBe(true);
		expect(dragHasFiles(['text/plain', 'text/uri-list'])).toBe(false);
	});
});
