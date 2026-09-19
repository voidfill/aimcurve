import { describe, expect, it } from 'vitest';
import { workerBuilder } from './worker';

class FailingWorker extends EventTarget {
	postMessage(): void {}
}

describe('workerBuilder', () => {
	it('rejects every pending build when the worker errors', async () => {
		const worker = new FailingWorker();
		const build = workerBuilder(worker as unknown as Worker);
		const first = build([]);
		const second = build([]);

		worker.dispatchEvent(new ErrorEvent('error', { message: 'worker failed' }));

		await expect(first).rejects.toThrow('worker failed');
		await expect(second).rejects.toThrow('worker failed');
	});
});
