import { describe, expect, it } from 'vitest';
import { pack, unpack } from '../src/db/packed';
import { parseKills } from '../src/core/statscsv';
import { readStats } from './fixtures';

const AIR = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const EASTER = 'Happy Easter! - Challenge - 2026.04.06-18.13.05';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';

describe('pack / unpack', () => {
  it('round-trips a run\'s kills exactly', () => {
    const kills = parseKills(readStats(AIR));
    expect(unpack(pack(AIR, kills))).toEqual(kills);
  });

  it('round-trips every fixture', () => {
    for (const id of [AIR, EASTER, TRACKING]) {
      const kills = parseKills(readStats(id));
      expect(unpack(pack(id, kills))).toEqual(kills);
    }
  });

  it('is one record, not one per kill', () => {
    const packed = pack(AIR, parseKills(readStats(AIR)));
    expect(packed.n).toBe(5);
    expect(packed.ttk).toBeInstanceOf(Float64Array);
    expect(packed.ttk).toHaveLength(5);
    expect(packed.bots).toEqual([
      'AIR1_Short_close', 'AIR1_Short_far', 'AIR2_Long3D_mid',
      'AIR2_Short_close', 'AIR2_Mid_UFO',
    ]);
  });

  it('handles a run with no kills at all', () => {
    // 1090 of 2360 real runs. The normal case, not an edge case.
    const packed = pack(TRACKING, []);
    expect(packed.n).toBe(0);
    expect(unpack(packed)).toEqual([]);
  });

  it('preserves nulls through NaN', () => {
    const kills = [{
      idx: 1, t: 1.5, bot: 'b', weapon: 'w', ttk: null,
      shots: null, hits: 3, overshots: null, dmg_done: null, dmg_possible: 0,
    }];
    expect(unpack(pack('x', kills))).toEqual(kills);
  });

  it('renumbers idx from position, as parseKills does', () => {
    // Happy Easter! writes 0 in the file's own Kill # column on every row.
    const kills = parseKills(readStats(EASTER));
    expect(unpack(pack(EASTER, kills)).map((k) => k.idx)).toEqual([1, 2]);
  });
});
