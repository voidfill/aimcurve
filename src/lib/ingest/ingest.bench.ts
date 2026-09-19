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
 */
import { PGlite } from '@electric-sql/pglite';
import { bench, describe } from 'vitest';
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

describe('ingest pipeline', () => {
	bench('parse csv', () => {
		for (const text of statsText) parseStatsCsv(text);
	});

	bench('parse perf', () => {
		for (const bytes of perfBytes) parsePerf(bytes);
	});

	bench('build copy payloads', () => {
		buildChunk(files);
	});

	// A fresh database per iteration, or the second iteration measures
	// `on conflict do nothing` instead of an insert.
	let pg: PGlite;
	let chunk: ChunkResult;

	bench(
		'full ingest',
		async () => {
			await applyChunk(pg, chunk);
		},
		{
			iterations: 3,
			async setup() {
				pg = new PGlite();
				await applyMigrations(pg, migrations);
				chunk = buildChunk(files);
			},
			async teardown() {
				await pg.close();
			},
		},
	);
});
