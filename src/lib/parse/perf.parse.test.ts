import { describe, expect, it } from 'vitest';
import { curated, raw } from '../../../test/helpers/fixtures';
import { parsePerf, TICK_METRICS } from './perf';

/** Every curated perf, parsed. The set is small enough to parse in one go. */
const parsed = curated.list('performances').map((name) => ({
	name,
	perf: parsePerf(curated.bytes('performances', name)),
}));

describe('parsePerf', () => {
	it('parses every curated file with a plausible header', () => {
		expect(parsed.length).toBeGreaterThan(0);
		for (const { name, perf } of parsed) {
			expect(perf.header.scenarioHash, name).toHaveLength(32);
			expect(perf.header.schemaVersion, name).toBe(1);
			// Truncated to the whole second by the format.
			expect(perf.header.challengeStartUtcMs % 1000, name).toBe(0);
			// Epoch ms, not seconds: 2020-01-01 or later.
			expect(perf.header.challengeStartUtcMs, name).toBeGreaterThan(1_577_836_800_000);
		}
	});

	it('produces tick arrays that are aligned and ordered', () => {
		for (const { name, perf } of parsed) {
			const n = perf.ticks.t.length;
			expect(n, name).toBeGreaterThan(0);
			for (let i = 1; i < n; i++) expect(perf.ticks.t[i]!, name).toBeGreaterThan(perf.ticks.t[i - 1]!);
			for (const key of TICK_METRICS) {
				const column = perf.ticks.metrics[key];
				if (column !== null) expect(column!.length, `${name}/${key}`).toBe(n);
			}
		}
	});

	it('emits a null column for a metric the run never reported', () => {
		// Tracking scenarios never emit `kills`; at least one curated file is one.
		const anyNull = parsed.some(({ perf }) => perf.ticks.metrics.kills === null);
		expect(anyNull).toBe(true);
	});

	it('raises on an event type outside the 13 observed', () => {
		// `deaths` is field 9: never observed, and adding it is a migration.
		const bytes = new Uint8Array([
			0x0a, 0x00, // header {}
			0x12, 0x07, // events[0] { (7 bytes: 5 for the fixed32, 2 for the empty submessage)
			0x0d, 0x00, 0x00, 0x00, 0x00, //   timestamp = 0.0
			0x4a, 0x00, //   deaths {}
		]);
		expect(() => parsePerf(bytes)).toThrow(/deaths/);
	});
});

describe.skipIf(!raw.available)('parsePerf over the full dump', () => {
	it('parses every file', () => {
		const failures: string[] = [];
		for (const name of raw.list('performances')) {
			try {
				parsePerf(raw.bytes('performances', name));
			} catch (err) {
				failures.push(`${name}: ${String(err)}`);
			}
		}
		expect(failures).toEqual([]);
	});
});
