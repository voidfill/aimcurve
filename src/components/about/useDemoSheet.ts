/**
 * The demo benchmark category as Benchmarks sheet rows, for About's third beat
 * and the link card: the category's own row, its subcategories and scenarios,
 * from the snapshot source the caller's parent provides. Nothing stored: the
 * run window and coverage are fixed, and "now" is the sample's last run, so
 * nothing in it ages into "stale".
 */
import { computed, type Ref, ref } from 'vue';
import { useBenchmarkPage } from '../../composables/useBenchmarkPage';
import { DEMO_BENCHMARK_ID, DEMO_CATEGORY } from '../../lib/demo/snapshot';

export const DEMO_RUN_WINDOW = 10;

export function useDemoSheet(now: Ref<number>) {
	const runWindow = ref(DEMO_RUN_WINDOW);
	const page = useBenchmarkPage(ref(DEMO_BENCHMARK_ID), {
		runWindow,
		mode: ref('provisional'),
		now: () => now.value,
	});
	const category = computed(() => page.rows.value.find((r) => r.level === 'category' && r.name === DEMO_CATEGORY) ?? null);
	const rows = computed(() => {
		const key = category.value?.key;
		return key === undefined ? [] : page.rows.value.filter((r) => r.key === key || r.parents.includes(key));
	});
	return { page, runWindow, category, rows };
}
