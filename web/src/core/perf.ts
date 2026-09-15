/** Decoding `performances/*.perf`.
 *
 * KovaaK's publishes no schema. The layout below was recovered from the
 * protobuf wire format and validated by summation against the CSV totals.
 *
 *     top level
 *       field 1  header submessage
 *                  1 scenario name, 2 hash, 3 epoch-ms start,
 *                  4 unknown int, 5 submessage (bot file, map, weapon)
 *       field 2  repeated sample: field 1 = float timestamp, plus exactly one
 *                metric submessage whose field number selects the series
 *
 * THE TRAP: a metric is omitted for a second in which it was zero, so sample
 * order is not time order and the series have different lengths in the file.
 * Every series is rebuilt here on a dense floor(timestamp) grid.
 *
 * THE OTHER TRAP: integer series arrive as varints and float series as
 * fixed32. Reading only the fixed32s parses cleanly and yields four zero
 * series.
 */

import { SERIES, type Curve, type PerfHeader, type Series, type SeriesName } from './types';

export class PerfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerfError';
  }
}

const FIELD_TO_SERIES: Record<number, SeriesName> = {
  2: 'shots',
  3: 'hits',
  4: 'misses',
  5: 'dmg_done',
  6: 'dmg_possible',
  7: 'score',
  8: 'kills',
};

const TEXT = new TextDecoder('utf-8');

interface Field {
  number: number;
  wire: number;
  /** varint value for wire 0; a subarray for wires 1, 2 and 5. */
  value: number | Uint8Array;
}

function readVarint(buf: Uint8Array, i: number): [number, number] {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (i >= buf.length) throw new PerfError('truncated varint');
    const byte = buf[i];
    i += 1;
    // Multiplication rather than `<< shift`: JS bitwise operators are 32-bit,
    // and the header's epoch-ms start does not fit in 32.
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [result, i];
    shift += 7;
    if (shift > 63) throw new PerfError('varint too long');
  }
}

/** Every (field number, wire type, payload) at one nesting level. */
function* fields(buf: Uint8Array): Generator<Field> {
  let i = 0;
  while (i < buf.length) {
    let key: number;
    [key, i] = readVarint(buf, i);
    const number = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      let value: number;
      [value, i] = readVarint(buf, i);
      yield { number, wire, value };
    } else if (wire === 5) {
      if (i + 4 > buf.length) throw new PerfError('truncated fixed32');
      yield { number, wire, value: buf.subarray(i, i + 4) };
      i += 4;
    } else if (wire === 1) {
      if (i + 8 > buf.length) throw new PerfError('truncated fixed64');
      yield { number, wire, value: buf.subarray(i, i + 8) };
      i += 8;
    } else if (wire === 2) {
      let length: number;
      [length, i] = readVarint(buf, i);
      if (i + length > buf.length) {
        throw new PerfError('truncated length-delimited field');
      }
      yield { number, wire, value: buf.subarray(i, i + length) };
      i += length;
    } else {
      throw new PerfError(`unsupported wire type ${wire}`);
    }
  }
}

function f32(raw: Uint8Array): number {
  return new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true);
}

function parseHeader(payload: Uint8Array): PerfHeader {
  const out: PerfHeader = { scenario: null, hash: null, started_ms: null };
  for (const { number, wire, value } of fields(payload)) {
    if (number === 1 && wire === 2) out.scenario = TEXT.decode(value as Uint8Array);
    else if (number === 2 && wire === 2) out.hash = TEXT.decode(value as Uint8Array);
    else if (number === 3 && wire === 0) out.started_ms = value as number;
  }
  return out;
}

type Sample = [timestamp: number, name: SeriesName, value: number];

function parseSample(payload: Uint8Array): Sample | null {
  let timestamp: number | null = null;
  let found: [SeriesName, number] | null = null;
  for (const { number, wire, value } of fields(payload)) {
    if (number === 1 && wire === 5) {
      timestamp = f32(value as Uint8Array);
    } else if (wire === 2 && number in FIELD_TO_SERIES) {
      for (const inner of fields(value as Uint8Array)) {
        if (inner.number !== 1) continue;
        found = [
          FIELD_TO_SERIES[number],
          inner.wire === 5 ? f32(inner.value as Uint8Array) : (inner.value as number),
        ];
      }
    }
  }
  if (timestamp === null || found === null) return null;
  return [timestamp, found[0], found[1]];
}

export function parsePerf(raw: Uint8Array): Curve & { header: PerfHeader } {
  if (!raw.length) throw new PerfError('empty file');

  let header: PerfHeader = { scenario: null, hash: null, started_ms: null };
  const samples: Sample[] = [];
  let lastTimestamp = 0;

  for (const { number, wire, value } of fields(raw)) {
    if (number === 1 && wire === 2) {
      header = parseHeader(value as Uint8Array);
    } else if (number === 2 && wire === 2) {
      const parsed = parseSample(value as Uint8Array);
      if (parsed === null) continue;
      samples.push(parsed);
      if (parsed[0] > lastTimestamp) lastTimestamp = parsed[0];
    }
  }

  if (!samples.length) throw new PerfError('no samples decoded');

  // Dense grid. floor(timestamp) is the bucket; gaps stay zero.
  const buckets = Math.trunc(lastTimestamp) + 1;
  const series = Object.fromEntries(
    SERIES.map((name) => [name, new Float32Array(buckets)]),
  ) as Series;

  for (const [timestamp, name, value] of samples) {
    const index = Math.trunc(timestamp);
    // Accumulating into the Float32Array rather than a number[] is deliberate:
    // Python's array('f') rounds to binary32 after every +=, and curve values
    // are compared against it with no tolerance.
    if (index >= 0 && index < buckets) series[name][index] += value;
  }

  return { buckets, duration_s: lastTimestamp, series, header };
}
