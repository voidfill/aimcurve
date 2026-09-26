import { describe, expect, it } from 'vitest';
import { createApp, ref, shallowRef } from 'vue';
import { snapshotSource } from '../lib/demo/snapshot';
import { SOURCE_KEY, type SourceApi, useSource } from './useSource';

describe('useSource', () => {
	it('throws without a provider, so no view silently falls back to the database', () => {
		const app = createApp({});
		expect(() => app.runWithContext(() => useSource())).toThrow(/no data source/i);
	});

	it('returns the provided source', () => {
		const api: SourceApi = { source: shallowRef(snapshotSource({} as never)), revision: ref(0) };
		const app = createApp({});
		app.provide(SOURCE_KEY, api);
		expect(app.runWithContext(() => useSource())).toBe(api);
	});
});
