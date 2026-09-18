import { create, fromBinary, fromJson, toBinary, toJson } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { NoteListSchema, NoteSchema } from './gen/example_pb';

describe('protobuf', () => {
	it('round-trips a message through binary', () => {
		const note = create(NoteSchema, { id: 7, body: 'hello', createdAtMs: 1700000000000n });

		const decoded = fromBinary(NoteSchema, toBinary(NoteSchema, note));

		expect(decoded).toEqual(note);
		expect(decoded.createdAtMs).toBe(1700000000000n);
	});

	it('round-trips nested messages through JSON', () => {
		const list = create(NoteListSchema, {
			notes: [create(NoteSchema, { id: 1, body: 'a' }), create(NoteSchema, { id: 2, body: 'b' })],
		});

		const json = toJson(NoteListSchema, list);

		expect(json).toEqual({ notes: [{ id: 1, body: 'a' }, { id: 2, body: 'b' }] });
		expect(fromJson(NoteListSchema, json)).toEqual(list);
	});

	it('leaves proto3 defaults off the wire', () => {
		const empty = create(NoteSchema);
		expect(toBinary(NoteSchema, empty)).toHaveLength(0);
	});
});
