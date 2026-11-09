/**
 * The session totals concern of `useAttempts`: which sessions are read, when,
 * and that totals read for one scope never show under another. The queries are
 * stubbed; their SQL is covered by `lib/run/queries.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, shallowRef } from 'vue';
import type { AttemptCursor, RailAttempt, SessionSummary } from '../lib/run/queries';

const revision = ref(0);
const selection = {
	mode: ref<'follow' | 'inspect'>('follow'),
	fileStem: ref<string | null>(null),
	scenarioHash: ref<string | null>(null),
	latestSeen: shallowRef<AttemptCursor | null>(null),
};

/** Pages by scope: the cursor's id picks the page, null the first. */
let pages: Map<number | null, RailAttempt[][]>;
/** Every totals read, as `[ids, scope]`, and how to answer it. */
let reads: [number[], number | null][];
let answer: (ids: readonly number[], scope: number | null) => Promise<SessionSummary[]>;

vi.mock('./useDb', () => ({ useDb: () => ({ pg: shallowRef({}) }) }));
vi.mock('./useImport', () => ({ useImport: () => ({ revision }) }));
vi.mock('./useSelection', () => ({ useSelection: () => selection }));
vi.mock('../lib/run/queries', () => ({
	listScenarios: async () => [
		{ id: 1, name: 'A', hash: 'a' },
		{ id: 2, name: 'B', hash: 'b' },
	],
	listAttempts: async (_pg: unknown, scope: number | null, before: AttemptCursor | null) => {
		const list = pages.get(scope) ?? [[]];
		const index = before === null ? 0 : before.id;
		const next = index + 1 < list.length ? { writtenAt: '2026-01-01T00:00:00.000Z', id: index + 1 } : null;
		return { items: list[index] ?? [], next };
	},
	listSessionSummaries: (_pg: unknown, ids: readonly number[], scope: number | null) => {
		reads.push([[...ids], scope]);
		return answer(ids, scope);
	},
	getLatestAttempt: async () => null,
	getAttempt: async () => null,
}));

const { useAttempts } = await import('./useAttempts');

function row(fileStem: string, sessionId: number, scenarioId: number): RailAttempt {
	return { fileStem, sessionId, scenarioId, writtenAt: '2026-01-01T00:00:00.000Z', id: 0 } as RailAttempt;
}

function summary(sessionId: number, scope: number | null): SessionSummary {
	return {
		sessionId,
		startedAt: '2026-01-01T00:00:00.000Z',
		endedAt: '2026-01-01T00:00:00.000Z',
		runs: scope === null ? 10 : 2,
		scenarios: [],
	};
}

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await nextTick();
		await Promise.resolve();
	}
};

function start() {
	reads = [];
	answer = async (ids, scope) => ids.map((id) => summary(id, scope));
	const scope = effectScope();
	const api = scope.run(() => useAttempts())!;
	return { api, stop: () => scope.stop() };
}

let stop: (() => void) | null = null;
afterEach(() => {
	stop?.();
	selection.scenarioHash.value = null;
});

describe('useAttempts session totals', () => {
	it('drops totals the moment the scope changes, and discards a late reply for the old scope', async () => {
		pages = new Map([
			[null, [[row('x', 10, 1), row('y', 10, 2)]]],
			[2, [[row('y', 10, 2)]]],
		]);
		const started = start();
		stop = started.stop;
		const { api } = started;
		await settle();
		expect(api.sessions.value.get(10)?.runs).toBe(10);

		// An import's re-read of the unfiltered totals is still in flight...
		let late!: () => void;
		answer = (ids, scope) =>
			new Promise((resolve) => (late = () => resolve(ids.map((id) => summary(id, scope)))));
		revision.value += 1;
		await settle();

		// ...when the filter switches: the held totals go at once.
		answer = async (ids, scope) => ids.map((id) => summary(id, scope));
		selection.scenarioHash.value = 'b';
		await nextTick();
		expect(api.sessions.value.size).toBe(0);

		await settle();
		expect(reads[reads.length - 1]).toEqual([[10], 2]);
		expect(api.sessions.value.get(10)?.runs).toBe(2);

		// The old scope's reply arrives last and is not written.
		late();
		await settle();
		expect(api.sessions.value.get(10)?.runs).toBe(2);
	});

	it('reads only new sessions when older rows load, and every shown session after an import', async () => {
		pages = new Map([[null, [[row('a', 20, 1)], [row('b', 20, 1), row('c', 19, 1)]]]]);
		const started = start();
		stop = started.stop;
		const { api } = started;
		await settle();
		expect(reads).toEqual([[[20], null]]);

		await api.loadOlder();
		await settle();
		expect(reads[reads.length - 1]).toEqual([[19], null]);
		expect([...api.sessions.value.keys()].sort()).toEqual([19, 20]);

		revision.value += 1;
		await settle();
		expect(reads[reads.length - 1]).toEqual([[20, 19], null]);
	});
});
