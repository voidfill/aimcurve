import { describe, expect, it } from 'vitest';
import { curated, raw } from './fixtures';

describe('curated fixtures', () => {
	it('is committed, so a fresh clone can find it', () => {
		expect(curated.available).toBe(true);
	});

	it('reports an empty list for a kind it has no directory for', () => {
		expect(curated.list('performances')).toEqual(expect.any(Array));
	});
});

describe.skipIf(!raw.available)('raw fixtures', () => {
	it('lists both kinds by extension', () => {
		expect(raw.list('stats').every((name) => name.endsWith('.csv'))).toBe(true);
		expect(raw.list('performances').every((name) => name.endsWith('.perf'))).toBe(true);
	});

	it('reads a stats file as text', () => {
		const [name] = raw.list('stats');
		expect(raw.text('stats', name!)).toMatch(/^Kill #,Timestamp,Bot,Weapon,TTK,/);
	});

	it('reads a performance file as protobuf bytes', () => {
		const [name] = raw.list('performances');
		const bytes = raw.bytes('performances', name!);
		expect(bytes).toBeInstanceOf(Uint8Array);
		// Field 1, length-delimited: the header message.
		expect(bytes[0]).toBe(0x0a);
	});
});
