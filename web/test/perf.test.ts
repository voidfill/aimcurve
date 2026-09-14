import { describe, expect, it } from 'vitest';
import { PerfError, parsePerf } from '../src/core/perf';
import { readPerf, readTruncatedPerf } from './fixtures';

const AIR = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const RELOAD = 'Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';
const GROUND = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';

const sum = (a: Float32Array) => Array.from(a).reduce((x, y) => x + y, 0);
const nonZero = (a: Float32Array) => Array.from(a).filter((v) => v !== 0).length;

describe('parsePerf', () => {
  it('rebuilds a dense one-second grid', () => {
    const c = parsePerf(readPerf(AIR)!);
    expect(c.buckets).toBe(86);
    expect(c.duration_s).toBeCloseTo(85.98716735839844, 10);
    for (const name of Object.keys(c.series) as (keyof typeof c.series)[]) {
      expect(c.series[name]).toHaveLength(86);
      expect(c.series[name]).toBeInstanceOf(Float32Array);
    }
  });

  it('sums each series to the CSV total', () => {
    // This is the validation that recovered the field map in the first place.
    const c = parsePerf(readPerf(AIR)!);
    expect(sum(c.series.shots)).toBe(8501);
    expect(sum(c.series.hits)).toBe(5000);
    expect(sum(c.series.misses)).toBe(3501);
    expect(sum(c.series.dmg_done)).toBe(5000);
    expect(sum(c.series.dmg_possible)).toBe(8501);
    expect(sum(c.series.kills)).toBe(5);
    expect(sum(c.series.score)).toBeCloseTo(913.9939, 3);
  });

  it('reads varint series, not only fixed32 ones', () => {
    // shots/hits/misses/kills are varints and dmg/score are fixed32. A decoder
    // that reads only fixed32 parses without error and returns four zero
    // series, which is why this is asserted rather than assumed.
    const c = parsePerf(readPerf(TRACKING)!);
    expect(sum(c.series.shots)).toBe(6001);
    expect(sum(c.series.hits)).toBe(3913);
    expect(sum(c.series.misses)).toBe(2088);
    expect(sum(c.series.dmg_done)).toBe(3913);
  });

  it('leaves omitted zero buckets at zero rather than compacting them', () => {
    // 60 seconds of play, but only 26 of them recorded a miss. If sample order
    // were treated as time order every curve would silently shift left.
    const c = parsePerf(readPerf(RELOAD)!);
    expect(c.buckets).toBe(60);
    expect(nonZero(c.series.shots)).toBe(59);
    expect(nonZero(c.series.hits)).toBe(43);
    expect(nonZero(c.series.misses)).toBe(26);
    expect(Array.from(c.series.misses.slice(0, 6))).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('places events in the second they happened', () => {
    // Five kills in an 86-second run, at the seconds the CSV also reports.
    const c = parsePerf(readPerf(AIR)!);
    const at = Array.from(c.series.kills)
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0);
    expect(at).toEqual([14, 31, 47, 65, 85]);
  });

  it('reads the header', () => {
    const c = parsePerf(readPerf(AIR)!);
    expect(c.header.scenario).toBe('Air Pure Medium');
    expect(c.header.hash).toBe('d852bc1c12b4bfd7cac1752067620ce2');
  });

  it('carries a race scenario countdown in the score series', () => {
    const c = parsePerf(readPerf(AIR)!);
    expect(c.series.score[0]).toBeCloseTo(998.9974, 3);
    expect(c.series.score[1]).toBeCloseTo(-0.999, 3);
    expect(c.series.score[2]).toBeCloseTo(-0.9996, 3);
  });

  it('books damage only at kill time on some scenarios', () => {
    // 5928 shots but 5.93 damage possible. This is the signature the payload
    // builder uses to withhold the efficiency metric.
    const c = parsePerf(readPerf(GROUND)!);
    expect(sum(c.series.shots)).toBe(5928);
    expect(sum(c.series.dmg_possible)).toBeCloseTo(5.9278, 3);
  });

  it('rejects a truncated file rather than returning a short curve', () => {
    expect(() => parsePerf(readTruncatedPerf())).toThrow(PerfError);
    expect(() => parsePerf(readTruncatedPerf()))
      .toThrow('truncated length-delimited field');
  });

  it('rejects an empty file', () => {
    expect(() => parsePerf(new Uint8Array(0))).toThrow(PerfError);
  });
});
