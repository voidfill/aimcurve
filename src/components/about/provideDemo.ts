/**
 * Loads the demo snapshot and provides it as the data source for the calling
 * component's subtree (D2 of the About design). The benchmark ladder loads in
 * the same step, so rank bands never pop in after the chart.
 *
 * Call it from the page component; the charts must live in children, because
 * `inject` never sees the calling component's own `provide`.
 */
import { ref, shallowRef } from 'vue';
import { loadSnapshot } from '../../composables/useBenchmarkRank';
import { provideSource } from '../../composables/useSource';
import type { DataSource } from '../../lib/data-source';
import { DEMO_RUN_STEM, type DemoSnapshot, snapshotSource } from '../../lib/demo/snapshot';
import type { Attempt } from '../../lib/run/queries';

export function provideDemo() {
	const source = shallowRef<DataSource | null>(null);
	provideSource({ source, revision: ref(0) });

	const state = ref<'loading' | 'ready' | 'error'>('loading');
	/** The run About charts. */
	const attempt = shallowRef<Attempt | null>(null);

	async function load(): Promise<void> {
		try {
			const [module] = await Promise.all([import('../../data/demo-snapshot.json'), loadSnapshot()]);
			const snapshot = module.default as unknown as DemoSnapshot;
			attempt.value = snapshot.attempts[DEMO_RUN_STEM] ?? null;
			source.value = snapshotSource(snapshot);
			// A snapshot without the pinned run would leave About on a placeholder forever.
			state.value = attempt.value ? 'ready' : 'error';
		} catch {
			state.value = 'error';
		}
	}

	void load();
	return { state, attempt };
}
