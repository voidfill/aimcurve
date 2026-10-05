/**
 * The history pass over 100k synthetic runs across 30 scenarios.
 * The budget is one frame, 16 ms; over it, the pass can move to a compute
 * worker. See docs/arc.md.
 *
 * As in `ingest.bench.ts`, `bench` is a test-context fixture in vitest 5, and
 * each `test` only hosts one `bench(...).run()`.
 */
import { test } from 'vitest';
import { syntheticRows, syntheticSnapshot } from '../../../test/helpers/arc';
import { arcTree } from './aggregate';
import { historyPass, toStream } from './history';
import { spreadPass } from './spread';

const tree = arcTree(syntheticSnapshot(3, 5, 2), 0)!;
const rows = syntheticRows(100_000, tree.names.length);
const stream = toStream(tree, rows);

test('stream', async ({ bench }) => {
	await bench('toStream, 100k runs', () => {
		toStream(tree, rows);
	}).run();
});

test('history pass', async ({ bench }) => {
	await bench('historyPass, 100k runs, N = 10', () => {
		historyPass(tree, stream, 10, 'provisional');
	}).run();
});

test('spread', async ({ bench }) => {
	await bench('spreadPass, 100k runs, W = 50', () => {
		spreadPass(tree, stream, 50);
	}).run();
});
