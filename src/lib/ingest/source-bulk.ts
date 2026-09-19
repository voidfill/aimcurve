/**
 * A source over the `FileList` from `<input type="file" webkitdirectory>`.
 *
 * Works in every browser, Safari included, and is the only path available where
 * `showDirectoryPicker` is not — which is Firefox, Safari, and Chromium wherever
 * the picker's blocklist covers the install path. It is a snapshot: files
 * created after the pick never appear, so there is no `watch`.
 */
import type { FileSource, SourceEntry } from './source';

export function bulkSource(files: FileList | File[]): FileSource {
	const all = Array.from(files);
	return {
		async list(): Promise<SourceEntry[]> {
			return all.map((file): SourceEntry => ({ name: file.name, open: async () => file }));
		},
	};
}
