/**
 * `useScenario` over both sources: About's progression chart must show what
 * the scenario page would.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, effectScope, ref, shallowRef } from 'vue';
import { makeTestDb } from '../../test/helpers/db';
import { demo } from '../../test/helpers/fixtures';
import snapshotJson from '../data/demo-snapshot.json';
import { type DataSource, pgSource } from '../lib/data-source';
import { DEMO_SCENARIO_HASH, type DemoSnapshot, snapshotSource } from '../lib/demo/snapshot';
import { applyChunk } from '../lib/ingest/batch';
import { buildChunk } from '../lib/ingest/chunk';
import { type ScenarioApi, useScenario } from './useScenario';
import { SOURCE_KEY } from './useSource';

/** Loads can outlast vi.waitFor's 1 s default while the whole suite runs. */
const WAIT = { timeout: 10_000 };

const snapshot = snapshotJson as unknown as DemoSnapshot;

async function load(source: DataSource): Promise<ScenarioApi> {
	const app = createApp({});
	app.provide(SOURCE_KEY, { source: shallowRef(source), revision: ref(0) });
	const api = app.runWithContext(() => effectScope().run(() => useScenario(ref(DEMO_SCENARIO_HASH)))!);
	await vi.waitFor(() => expect(api.state.value).toBe('ready'), WAIT);
	api.loadBots();
	await vi.waitFor(() => expect(api.botState.value).toBe('ready'), WAIT);
	return api;
}

describe('useScenario', () => {
	let pg: PGlite;

	beforeAll(async () => {
		({ pg } = await makeTestDb());
		const files = (['stats', 'performances'] as const).flatMap((kind) =>
			demo.list(kind).map((name) => ({ name, bytes: demo.bytes(kind, name) })),
		);
		await applyChunk(pg, buildChunk(files));
	});

	it('loads the demo scenario from the snapshot exactly as from the database', async () => {
		const fromDb = await load(pgSource(pg));
		const fromSnapshot = await load(snapshotSource(snapshot));
		expect(fromSnapshot.data.value).toEqual(fromDb.data.value);
		expect(fromSnapshot.bots.value).toEqual(fromDb.bots.value);
		expect(fromSnapshot.data.value!.runs).toHaveLength(snapshot.history[fromSnapshot.data.value!.scenario.id]!.length);
	});
});
