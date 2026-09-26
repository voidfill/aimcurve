import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, shallowRef } from 'vue';

const present = { value: false };
const query = vi.fn(async () => ({ rows: [{ present: present.value }] }));
const revision = ref(0);

vi.mock('./useDb', () => ({ useDb: () => ({ pg: shallowRef({ query }) }) }));
vi.mock('./useImport', () => ({ useImport: () => ({ revision }) }));

const { useHasRuns } = await import('./useHasRuns');

const settle = async () => {
	await nextTick();
	await Promise.resolve();
	await Promise.resolve();
};

describe('useHasRuns', () => {
	it('keeps following imports after the view that first asked unmounts', async () => {
		// The first caller is a view; leaving it for Data stops its scope.
		const view = effectScope();
		const hasRuns = view.run(() => useHasRuns())!;
		await settle();
		expect(hasRuns.value).toBe(false);
		view.stop();

		present.value = true;
		revision.value += 1;
		await settle();
		expect(hasRuns.value).toBe(true);
		expect(useHasRuns()).toBe(hasRuns);
	});
});
