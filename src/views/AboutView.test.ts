// @vitest-environment happy-dom
/**
 * About's isolation (D2, D3 of the About design): under the app's database
 * source it still draws only from its own snapshot, and it leaves the
 * visitor's storage alone apart from remembering that About was shown.
 *
 * The chart components are stubbed: uPlot needs a real canvas, and what
 * matters here is that they receive their data, not how they paint it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, ref, shallowRef } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { DataSource } from '../lib/data-source';
import { SEEN_ABOUT_KEY } from '../lib/about';
import { SOURCE_KEY } from '../composables/useSource';
import snapshotJson from '../data/demo-snapshot.json';
import { DEMO_PROGRESS_HASH, type DemoSnapshot } from '../lib/demo/snapshot';

const snapshot = snapshotJson as unknown as DemoSnapshot;

const received: Record<string, Record<string, unknown>> = {};

function stub(name: string) {
	return {
		default: defineComponent({
			name,
			inheritAttrs: false,
			setup(_, { attrs }) {
				return () => {
					received[name] = { ...attrs };
					return h('div', { 'data-stub': name });
				};
			},
		}),
	};
}

vi.mock('../components/UnifiedChart.vue', () => stub('UnifiedChart'));
vi.mock('../components/BotTable.vue', () => stub('BotTable'));
vi.mock('../components/ProgressChart.vue', () => stub('ProgressChart'));

/** A database source that fails the test the moment anything reads it. */
const calls: string[] = [];
const database = new Proxy({} as DataSource, {
	get: (_, method: string) => () => {
		calls.push(method);
		throw new Error(`About read the database: ${method}`);
	},
});

afterEach(() => {
	localStorage.clear();
	calls.length = 0;
	for (const name of Object.keys(received)) delete received[name];
});

async function mountAbout() {
	const { default: AboutView } = await import('./AboutView.vue');
	const blank = { render: () => null };
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [
			{ path: '/about', name: 'about', component: AboutView },
			{ path: '/data', name: 'data', component: blank },
		],
	});
	const app = createApp({ render: () => h('main', [h(AboutView)]) });
	app.use(router);
	app.provide(SOURCE_KEY, { source: shallowRef(database), revision: ref(0) });
	await router.push('/about');
	app.mount(document.createElement('div'));
	await vi.waitFor(() => expect(received.ProgressChart).toBeDefined(), { timeout: 10_000 });
	return app;
}

describe('AboutView', () => {
	it('draws every chart from the snapshot and never reads the database', async () => {
		const app = await mountAbout();
		expect(calls).toEqual([]);
		expect(received.UnifiedChart?.data).toBeTruthy();
		expect(received.BotTable?.data).toBeTruthy();
		const progress = snapshot.history[snapshot.scenarios[DEMO_PROGRESS_HASH]!.id]!;
		expect(received.ProgressChart?.y).toEqual(progress.map((r) => r.score));
		expect(received.ProgressChart?.['date-axis']).toBe(false);
		app.unmount();
	});

	it('writes nothing to storage but the seen-About mark', async () => {
		const app = await mountAbout();
		expect(Object.keys(localStorage)).toEqual([SEEN_ABOUT_KEY]);
		app.unmount();
	});
});
