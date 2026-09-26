/**
 * `useRunAnalysis` over both sources: the snapshot must yield the same
 * analysis the database does, which is what makes the About charts honest.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, ref, shallowRef } from 'vue';
import { makeTestDb } from '../../test/helpers/db';
import { demo } from '../../test/helpers/fixtures';
import snapshotJson from '../data/demo-snapshot.json';
import { type DataSource, pgSource } from '../lib/data-source';
import { DEMO_RUN_STEM, type DemoSnapshot, snapshotSource } from '../lib/demo/snapshot';
import { applyChunk } from '../lib/ingest/batch';
import { buildChunk } from '../lib/ingest/chunk';
import type { BaselineOption } from '../lib/run/baseline';
import type { Attempt } from '../lib/run/queries';
import { type RunAnalysisApi, useRunAnalysis } from './useRunAnalysis';
import { SOURCE_KEY } from './useSource';

const snapshot = snapshotJson as unknown as DemoSnapshot;

async function analyse(source: DataSource, option: BaselineOption): Promise<RunAnalysisApi> {
	const app = createApp({});
	app.provide(SOURCE_KEY, { source: shallowRef(source), revision: ref(0) });
	const attempt = ref<Attempt | null>(snapshot.attempts[DEMO_RUN_STEM]!);
	const api = app.runWithContext(() => effectScope().run(() => useRunAnalysis(attempt, ref(option)))!);
	await vi.waitFor(() => expect(api.state.value).toBe('ready'));
	return api;
}

/** What the charts are drawn from, with functions and typed arrays reduced to comparable data. */
function essence(api: RunAnalysisApi) {
	const a = api.analysis.value!;
	const b = api.baseline.value!;
	return {
		inspected: a.inspected,
		current: a.current && { stem: a.current.fileStem, u: [...a.current.u], params: a.current.params },
		recent: a.recent.map((c) => c.fileStem),
		window: a.window,
		baseline: { kind: b.kind, label: b.kind === 'none' ? null : b.label, stem: b.kind === 'charted' ? b.curve.fileStem : null },
		kills: a.killsOf(DEMO_RUN_STEM),
	};
}

describe('useRunAnalysis', () => {
	let pg: PGlite;

	beforeAll(async () => {
		({ pg } = await makeTestDb());
		const files = (['stats', 'performances'] as const).flatMap((kind) =>
			demo.list(kind).map((name) => ({ name, bytes: demo.bytes(kind, name) })),
		);
		await applyChunk(pg, buildChunk(files));
	});

	it('analyses the demo run from the snapshot exactly as from the database', async () => {
		const fromDb = essence(await analyse(pgSource(pg), 'pb-before'));
		const fromSnapshot = essence(await analyse(snapshotSource(snapshot), 'pb-before'));
		expect(fromSnapshot).toEqual(fromDb);
		expect(fromSnapshot.baseline.kind).toBe('charted');
		expect(fromSnapshot.recent.length).toBeGreaterThan(0);
	});

	it('takes the baseline option from its caller', async () => {
		const pb = await analyse(snapshotSource(snapshot), 'pb');
		const before = await analyse(snapshotSource(snapshot), 'pb-before');
		expect(pb.baseline.value!.kind).toBe('charted');
		expect(essence(pb).baseline.stem).not.toBe(essence(before).baseline.stem);
	});
});
