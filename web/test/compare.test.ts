import { describe, expect, it } from 'vitest';
import {
  band, compareUntil, cumulativeDelta, pad, raceDelta, raceGrid, resampleRace, smooth,
} from '../src/core/compare';
import { parsePerf } from '../src/core/perf';
import { readPerf } from './fixtures';

const AIR_A = 'Air Pure Medium - Challenge - 2026.09.03-19.08.37';
const AIR_B = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const GROUND_A = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.47.47';
const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';

const curve = (id: string) => parsePerf(readPerf(id)!);
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

describe('smooth', () => {
  it('is a centred rolling mean that shrinks at the edges', () => {
    expect(smooth([1, 2, 3, 4, 5], 3)).toEqual([1.5, 2, 3, 4, 4.5]);
  });

  it('is the identity below a window of two', () => {
    expect(smooth([1, 2, 3], 1)).toEqual([1, 2, 3]);
    expect(smooth([1, 2, 3], 0)).toEqual([1, 2, 3]);
  });

  it('preserves length', () => {
    expect(smooth([1, 2, 3, 4, 5, 6, 7], 5)).toHaveLength(7);
  });

  it('survives an empty series', () => {
    expect(smooth([], 5)).toEqual([]);
  });
});

describe('pad', () => {
  it('zero-extends both to the longer length', () => {
    expect(pad([1, 2, 3], [4])).toEqual([[1, 2, 3], [4, 0, 0]]);
  });
});

describe('cumulativeDelta', () => {
  it('ends exactly at the score difference', () => {
    // THE invariant. Run 11 scored 2009, run 10 scored 1814.
    const mine = Array.from(curve(GROUND_B).series.score);
    const base = Array.from(curve(GROUND_A).series.score);
    const values = cumulativeDelta(mine, base);
    // Exactly, not nearly: a tolerance here would hide the one class of bug
    // this port is most likely to have.
    expect(values[values.length - 1]).toBe(2009 - 1814);
    expect(values[values.length - 1]).toBe(sum(mine) - sum(base));
    expect(values.slice(0, 4)).toEqual([34, 66, 54, 52]);
  });

  it('pads rather than truncates, so totals survive a length mismatch', () => {
    // Truncating to the shorter prefix would report 3 here, not 7.
    expect(cumulativeDelta([5, 5], [2, 0, 3]).at(-1)).toBe(5);
    expect(cumulativeDelta([5, 5, 4], [2, 0]).at(-1)).toBe(12);
  });

  it('holds on curves of different lengths from the corpus', () => {
    const mine = Array.from(curve(AIR_B).series.score);   // 86 buckets
    const base = Array.from(curve(AIR_A).series.score);   // 94 buckets
    const values = cumulativeDelta(mine, base);
    expect(values).toHaveLength(94);
    expect(values.at(-1)).toBe(sum(mine) - sum(base));
  });
});

describe('compareUntil', () => {
  it('is the index past which only one curve has data', () => {
    expect(compareUntil([1, 2, 3], [1, 2])).toBe(2);
  });
});

describe('band', () => {
  it('collapses onto the mean under three curves', () => {
    // A standard deviation over two samples is noise pretending to be a
    // confidence band.
    expect(band([[1, 2], [3, 4]])).toEqual({
      mean: [2, 3], lo: [2, 3], hi: [2, 3],
    });
  });

  it('is mean +- one population sigma at three or more', () => {
    const b = band([[1, 2], [3, 4], [5, 9]]);
    expect(b.mean).toEqual([3, 5]);
    expect(b.lo[0]).toBeCloseTo(1.367007, 5);
    expect(b.hi[1]).toBeCloseTo(7.94392, 5);
  });

  it('truncates to the shortest curve', () => {
    expect(band([[1, 2, 3], [3, 4]]).mean).toHaveLength(2);
  });

  it('survives an empty set', () => {
    expect(band([])).toEqual({ mean: [], lo: [], hi: [] });
  });
});

describe('raceGrid', () => {
  it('is forty cells per bot, so kill boundaries land on exact indices', () => {
    expect(raceGrid(5)).toBe(200);
    expect(raceGrid(6)).toBe(240);
    expect(raceGrid(8)).toBe(320);
  });

  it('never returns zero', () => {
    expect(raceGrid(0)).toBe(40);
    expect(raceGrid(null)).toBe(40);
  });
});

describe('resampleRace', () => {
  it('indexes by cumulative damage and anchors to the CSV elapsed', () => {
    const [edges, rate] = resampleRace(curve(AIR_B).series.hits, 85.99399999999878, 200);
    expect(edges).toHaveLength(201);
    expect(rate).toHaveLength(200);
    expect(edges[0]).toBe(0);
    // Anchored, not merely bucketed: the curve's own last edge is rounded to a
    // whole second, and for a race that error lands straight in the score.
    expect(edges.at(-1)).toBeCloseTo(85.99399999999878, 10);
    expect(edges[1]).toBeCloseTo(0.280879, 6);
    expect(rate[0]).toBeCloseTo(89.00621, 5);
    expect(rate[3]).toBeCloseTo(88.563393, 5);
  });

  it('returns nothing usable when there is no damage or no elapsed', () => {
    expect(resampleRace(new Float32Array(10), 85, 200)).toEqual([[], []]);
    expect(resampleRace(curve(AIR_B).series.hits, 0, 200)).toEqual([[], []]);
  });
});

describe('raceDelta', () => {
  it('is seconds gained, ending at the elapsed difference', () => {
    const [mine] = resampleRace(curve(AIR_B).series.hits, 85.99399999999878, 200);
    const [base] = resampleRace(curve(AIR_A).series.hits, 93.84900000000198, 200);
    const values = raceDelta(mine, base);
    expect(values).toHaveLength(200);
    expect(values[0]).toBeCloseTo(0.086177, 6);
    expect(values.at(-1)).toBeCloseTo(7.855, 6);
  });

  it('lands within the CSV timestamp resolution of the score difference', () => {
    // Not exact the way cumulativeDelta is: elapsed comes from a kill
    // timestamp printed to three decimals while score carries the game's own
    // full-precision clock. 0.0057 s apart on this pair.
    const [mine] = resampleRace(curve(AIR_B).series.hits, 85.99399999999878, 200);
    const [base] = resampleRace(curve(AIR_A).series.hits, 93.84900000000198, 200);
    const scoreDiff = 913.998901 - 906.138184;
    expect(raceDelta(mine, base).at(-1)).toBeCloseTo(scoreDiff, 1);
    expect(Math.abs(raceDelta(mine, base).at(-1)! - scoreDiff)).toBeLessThan(0.02);
  });
});
