import { describe, expect, it } from 'vitest';
import { importOptions } from './import-options';

describe('importOptions', () => {
	it('offers Connect and nothing to drop when nothing is connected', () => {
		expect(importOptions('none', true)).toEqual({ live: false, reconnect: false, connect: 'connect', disconnect: false });
	});

	it('offers no folder actions where the directory picker is missing', () => {
		for (const connection of ['none', 'snapshot', 'error'] as const) {
			const options = importOptions(connection, false);
			expect(options.connect).toBeNull();
			expect(options.reconnect).toBe(false);
		}
	});

	it('hides Connect while live and offers Disconnect', () => {
		expect(importOptions('connected', true)).toEqual({ live: true, reconnect: false, connect: null, disconnect: true });
	});

	it('pairs Reconnect with Use another folder', () => {
		expect(importOptions('reconnect', true)).toEqual({ live: false, reconnect: true, connect: 'another', disconnect: true });
	});

	it('has nothing to disconnect after a snapshot', () => {
		expect(importOptions('snapshot', true).disconnect).toBe(false);
	});

	it('can drop a failed folder', () => {
		expect(importOptions('error', true).disconnect).toBe(true);
	});
});
