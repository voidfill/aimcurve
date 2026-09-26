/**
 * `pnpm gen:demo-fixtures`: refreshes `test/fixtures/demo/` from the raw dump.
 * Not a test. It only runs in vitest's `gen-demo-fixtures` mode, because it
 * needs the real ingest (Vite-only imports) to tell completed runs from
 * resets; `pnpm test` skips it.
 *
 * For each demo scenario it copies the CSV of every completed run and the
 * `.perf` written with it, and nothing else, so every demo fixture is a
 * charted run. See docs/preview-assets.md for the whole refresh.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../../../test/helpers/db';
import { demo, raw } from '../../../test/helpers/fixtures';
import { pgSource } from '../data-source';
import { applyChunk } from '../ingest/batch';
import { buildChunk } from '../ingest/chunk';
import { parseFilenameTime } from '../ingest/classify';
import { DEMO_SCENARIOS } from './snapshot';

/** A perf is written within a second or so of its CSV (see curated/README.md). */
const PAIR_MS = 2000;

describe.runIf(import.meta.env.MODE === 'gen-demo-fixtures')('gen:demo-fixtures', () => {
	it('copies every completed run of the demo scenarios from raw/', async () => {
		expect(raw.available, 'test/fixtures/raw/ is missing: copy an install’s stats/ and performances/ into it').toBe(true);
		const ofDemo = (name: string) => DEMO_SCENARIOS.some((s) => name.startsWith(`${s.name} - `));
		const stats = raw.list('stats').filter(ofDemo);
		const perfs = raw.list('performances').filter(ofDemo);

		const { pg } = await makeTestDb();
		await applyChunk(pg, buildChunk([
			...stats.map((name) => ({ name, bytes: raw.bytes('stats', name) })),
			...perfs.map((name) => ({ name, bytes: raw.bytes('performances', name) })),
		]));
		const db = pgSource(pg);
		const completed: string[] = [];
		for (const { name, hash } of DEMO_SCENARIOS) {
			const scenario = await db.getScenario(hash);
			expect(scenario, `${name} (${hash}) is not in raw/`).not.toBeNull();
			completed.push(...(await db.listHistory(scenario!.id)).map((r) => r.fileStem));
		}
		const times = completed.map((stem) => parseFilenameTime(stem)!.getTime());
		const paired = (perf: string) => {
			const t = parseFilenameTime(perf)!.getTime();
			return times.some((c) => Math.abs(c - t) <= PAIR_MS);
		};

		for (const kind of ['stats', 'performances'] as const) {
			rmSync(join(demo.dir, kind), { recursive: true, force: true });
			mkdirSync(join(demo.dir, kind), { recursive: true });
		}
		for (const stem of completed) copyFileSync(join(raw.dir, 'stats', `${stem} Stats.csv`), join(demo.dir, 'stats', `${stem} Stats.csv`));
		for (const perf of perfs.filter(paired)) copyFileSync(join(raw.dir, 'performances', perf), join(demo.dir, 'performances', perf));

		const copied = readdirSync(join(demo.dir, 'stats')).length;
		process.stdout.write(`demo fixtures: ${copied} runs, ${readdirSync(join(demo.dir, 'performances')).length} perfs\n`);
		expect(copied).toBe(completed.length);
	});
});
