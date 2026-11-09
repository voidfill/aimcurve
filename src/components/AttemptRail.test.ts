// @vitest-environment happy-dom
/**
 * The rail's load-bearing behaviour: rows grouped under session headers, and
 * older pages requested as the end comes into view — once per settled page,
 * never while one is in flight or after one failed. How rows look is checked
 * by eye, not here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { LoadState } from '../composables/useAttempts';
import type { RailAttempt, SessionSummary } from '../lib/run/queries';
import AttemptRail from './AttemptRail.vue';

vi.mock('../composables/useBenchmarkRank', () => ({
	loadedSnapshot: () => null,
	loadSnapshot: () => new Promise(() => {}),
	usePicks: () => ref({}),
	storedPicks: (picks: Record<string, number | null>) => picks,
}));

/** The observer's callback, so a test can scroll the sentinel into view. */
let observe: ((entries: { isIntersecting: boolean }[]) => void) | null = null;

beforeEach(() => {
	observe = null;
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
				observe = callback;
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});

afterEach(() => vi.unstubAllGlobals());

function attempt(fileStem: string, sessionId: number, score: number, prevScore: number | null): RailAttempt {
	return {
		id: 0,
		fileStem,
		scenarioId: 1,
		scenarioName: 'Pasu',
		scenarioHash: 'h',
		writtenAt: '2026-01-01T10:00:00.000Z',
		startedAt: '2026-01-01T10:00:00.000Z',
		score,
		durationS: 60,
		accuracy: null,
		hits: 0,
		shots: 0,
		hasPerf: true,
		sensScale: 'cm/360',
		horizSens: 1,
		vertSens: 1,
		kills: null,
		avgTtkS: null,
		efficiency: null,
		damageTaken: null,
		overshots: null,
		avgFps: null,
		prevScore,
		pbBefore: prevScore,
		sessionId,
	};
}

/** The props a test varies; the rest are fixed in `mount`. */
interface RailState {
	attempts: RailAttempt[];
	sessions: Map<number, SessionSummary>;
	state: LoadState;
	error: string | null;
	hasMore: boolean;
	loadingOlder: boolean;
}

function mount(state: RailState, loads: string[]) {
	const el = document.createElement('div');
	const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] });
	createApp({
		render: () =>
			h(AttemptRail, {
				...state,
				hasNewer: false,
				filtered: false,
				filterLabel: null,
				filterError: null,
				selectedStem: null,
				linkTo: () => '/',
				onLoadOlder: () => void loads.push('older'),
			}),
	})
		.use(router)
		.mount(el);
	return el;
}

describe('AttemptRail', () => {
	it('groups rows under one header per session, with each row’s change', async () => {
		const el = mount(
			{
				attempts: [attempt('a', 2, 72, 70), attempt('b', 2, 70, null), attempt('c', 1, 65, 60)],
				sessions: new Map(),
				state: 'ready' as const,
				error: null,
				hasMore: false,
				loadingOlder: false,
			},
			[],
		);
		await nextTick();
		const groups = el.querySelectorAll('.group');
		expect(groups).toHaveLength(2);
		expect(groups[0]!.querySelectorAll('.row')).toHaveLength(2);
		expect(groups[0]!.querySelector('.change')!.textContent).toContain('+2.0');
		expect(groups[0]!.querySelectorAll('.change')[1]!.textContent).toContain('first');
		expect(groups[0]!.querySelector('.pb')).not.toBeNull();
	});

	it('loads older pages once per settled page while the end is in view, and stops after a failure', async () => {
		const loads: string[] = [];
		const state = reactive<RailState>({
			attempts: [attempt('a', 1, 70, null)],
			sessions: new Map(),
			state: 'ready',
			error: null,
			hasMore: true,
			loadingOlder: false,
		});
		const el = mount(state, loads);
		await nextTick();
		expect(loads).toEqual([]);

		observe!([{ isIntersecting: true }]);
		await nextTick();
		expect(loads).toEqual(['older']);

		// In flight: the view sets loadingOlder; nothing more is requested.
		state.loadingOlder = true;
		await nextTick();
		expect(loads).toHaveLength(1);

		// Settled with the end still in view: the next page.
		state.loadingOlder = false;
		await nextTick();
		expect(loads).toHaveLength(2);

		// A failed page stops the loop and offers a retry instead.
		state.loadingOlder = true;
		await nextTick();
		state.error = 'disk on fire';
		state.loadingOlder = false;
		await nextTick();
		expect(loads).toHaveLength(2);
		const retry = el.querySelector<HTMLButtonElement>('.end button')!;
		expect(retry.textContent).toBe('Try again');
		retry.click();
		expect(loads).toHaveLength(3);
	});
});
