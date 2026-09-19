/**
 * `buildChunk` in a worker.
 *
 * The main thread orchestrates and the worker is a pure function, so the only
 * traffic is bytes in and bytes out — a few messages per *chunk*, not per file.
 * Payloads are `Uint8Array` and are transferred rather than copied.
 *
 * This file is both the worker script and the client factory. The worker half
 * runs only when `self` has no `window`, so importing `workerBuilder` from the
 * main thread does not install a message handler there.
 */
import { buildChunk, type ChunkResult, STAGE_TABLES } from './chunk';
import type { ChunkBuilder } from './index';

interface Request {
	id: number;
	files: { name: string; bytes: Uint8Array }[];
}

interface Response {
	id: number;
	result: ChunkResult;
}

if (typeof window === 'undefined' && typeof self !== 'undefined' && 'onmessage' in self) {
	self.addEventListener('message', (event: MessageEvent<Request>) => {
		const result = buildChunk(event.data.files);
		const transfer = STAGE_TABLES.map((table) => result.payloads[table].buffer);
		(self as unknown as Worker).postMessage({ id: event.data.id, result } satisfies Response, transfer);
	});
}

/** Wraps a live `Worker` as the `build` option `ingest()` takes. */
export function workerBuilder(worker: Worker): ChunkBuilder {
	let next = 0;
	const pending = new Map<number, { resolve: (result: ChunkResult) => void; reject: (error: Error) => void }>();

	worker.addEventListener('message', (event: MessageEvent<Response>) => {
		pending.get(event.data.id)?.resolve(event.data.result);
		pending.delete(event.data.id);
	});

	worker.addEventListener('error', (event) => {
		const error = new Error(event.message || 'ingest worker failed');
		for (const request of pending.values()) request.reject(error);
		pending.clear();
	});

	return (files) =>
		new Promise<ChunkResult>((resolve, reject) => {
			const id = next++;
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, files } satisfies Request, files.map((file) => file.bytes.buffer));
		});
}
