/**
 * Four stages of the pipeline, measured separately.
 *
 * No thresholds are asserted — this exists so a regression can be attributed to
 * parsing, to escaping, or to the database, rather than to "ingest".
 *
 * Files are read into memory once, outside every measured body, so the
 * filesystem is not part of any measurement. Runs against the full dump when it
 * is present and falls back to the curated set otherwise; the two are not
 * comparable, so do not read across them.
 *
 * In vitest 5, `bench` is not a module export — it is a test-context fixture,
 * only usable inside a `test()` registered in a file matched by
 * `benchmark.include` (default `**\/*.{bench,benchmark}.?(c|m)[jt]s?(x)`, which
 * `ingest.bench.ts` satisfies without touching `vitest.config.ts`). Each `test`
 * below exists only to host one `bench(...).run()` call; it asserts nothing.
 */
import { PGlite } from '@electric-sql/pglite';
import { test } from 'vitest';
import { curated, raw } from '../../../test/helpers/fixtures';
import { applyMigrations } from '../../db/migrate';
import { migrations } from '../../db/migrations';
import { parsePerf } from '../parse/perf';
import { parseStatsCsv } from '../parse/stats-csv';
import { applyChunk } from './batch';
import { buildChunk, type ChunkResult } from './chunk';

const set = raw.available ? raw : curated;

/** One chunk's worth, so `full ingest` measures a realistic transaction. */
const CHUNK = 200;

const statsNames = set.list('stats').slice(0, CHUNK);
const perfNames = set.list('performances').slice(0, CHUNK);

const statsText = statsNames.map((name) => set.text('stats', name));
const files = [
	...statsNames.map((name) => ({ name, bytes: set.bytes('stats', name) })),
	...perfNames.map((name) => ({ name, bytes: set.bytes('performances', name) })),
];
const perfBytes = perfNames.map((name) => set.bytes('performances', name));

test('parse csv', async ({ bench }) => {
	await bench('parse csv', () => {
		for (const text of statsText) parseStatsCsv(text);
	}).run();
});

test('parse perf', async ({ bench }) => {
	await bench('parse perf', () => {
		for (const bytes of perfBytes) parsePerf(bytes);
	}).run();
});

test('build copy payloads', async ({ bench }) => {
	await bench('build copy payloads', () => {
		buildChunk(files);
	}).run();
});

test('full ingest', async ({ bench }) => {
	let pg: PGlite;
	let chunk: ChunkResult;

	// A fresh database per iteration, or the second iteration measures
	// `on conflict do nothing` instead of an insert. `beforeEach`/`afterEach`
	// are tinybench's per-ITERATION hooks — unlike `setup`/`teardown` (which
	// run once per task execution, i.e. once for the whole warmup pass and once
	// for the whole timed pass), `beforeEach`/`afterEach` run around every
	// single call, so the fresh-boot cost of `pg` lands inside every sample.
	await bench(
		'full ingest',
		{
			async beforeEach() {
				pg = new PGlite();
				await applyMigrations(pg, migrations);
				chunk = buildChunk(files);
			},
			async afterEach() {
				await pg.close();
			},
		},
		async () => {
			await applyChunk(pg, chunk);
		},
		// Booting PGlite is expensive; a handful of iterations is enough to see
		// the shape of the stage without the suite taking minutes. `warmup:
		// false` avoids doubling the boot count for no benefit here.
	).run({ warmup: false, iterations: 3 });
});
