import { describe, expect, it } from 'vitest';
import { cm360, parseFilename, parseKills, parseStats } from '../src/core/statscsv';
import { readStats, statsIds } from './fixtures';

const AIR = 'Air Pure Medium - Challenge - 2026.09.12-16.04.49';
const FINALS = '1w2ts Pasu Perfected Easy - Challenge - 2025.12.29-22.57.12';
const EASTER = 'Happy Easter! - Challenge - 2026.04.06-18.13.05';
const TRACKING = 'Air Voltaic Invincible 4 Medium - Challenge - 2026.09.10-17.17.33';

describe('parseFilename', () => {
  it('splits the scenario from the timestamp', () => {
    expect(parseFilename(`${AIR} Stats.csv`)).toEqual({
      scenario: 'Air Pure Medium',
      started_at: '2026-09-12T16:04:49',
    });
  });

  it('keeps punctuation in a scenario name', () => {
    expect(parseFilename(`${EASTER} Stats.csv`)!.scenario).toBe('Happy Easter!');
  });

  it('rejects a name that is not a run', () => {
    expect(parseFilename('notes.txt')).toBeNull();
  });
});

describe('cm360', () => {
  it('is independent of the active sens scale', () => {
    // The FINALS 33 @ 400 DPI and cm/360 30 @ 1600 DPI are different labels;
    // the formula converts both without knowing which scale was active.
    // 13062.86 / (400 * 0.471429) = 69.27268. The plan wrote 69.2725, which is
    // outside toBeCloseTo's 5e-5 tolerance -- a slip in the plan, not in the
    // formula: the same constant gives the 30.0 below, and the FINALS fixture's
    // own cm360 of 69.27 agrees.
    expect(cm360(400, 0.471429)).toBeCloseTo(69.2727, 4);
    expect(cm360(1600, 0.272143)).toBeCloseTo(30.0, 4);
  });

  it('returns null rather than throwing on unusable input', () => {
    expect(cm360(null, 0.27)).toBeNull();
    expect(cm360(1600, 0)).toBeNull();
  });
});

describe('parseStats', () => {
  it('reads the summary block', () => {
    const run = parseStats(AIR, readStats(AIR));
    expect(run.score).toBeCloseTo(913.998901, 6);
    expect(run.kills).toBe(5);
    expect(run.hits).toBe(5000);
    expect(run.misses).toBe(3501);
    expect(run.shots).toBe(8501);
    expect(run.accuracy).toBeCloseTo(0.5881660981061052, 12);
    expect(run.avg_ttk).toBeCloseTo(17.197433, 6);
    expect(run.fight_time).toBeCloseTo(84.948997, 6);
    expect(run.game_version).toBe('3.9.9.2026-09-08-13-49-08-01c79144c86c');
  });

  it('reads the settings block and derives the sensitivity key', () => {
    const run = parseStats(AIR, readStats(AIR));
    expect(run.dpi).toBe(1600);
    expect(run.sens_increment).toBeCloseTo(0.272143, 6);
    expect(run.sens_scale).toBe('cm/360');
    expect(run.cm360).toBe(30.0);
    expect(run.cfg_key).toBe('30.0');
    expect(run.fov).toBe(103.0);
    expect(run.resolution).toBe('3440x1440');
  });

  it('keys a non-cm/360 scale on true centimetres', () => {
    const run = parseStats(FINALS, readStats(FINALS));
    expect(run.sens_scale).toBe('The FINALS');
    expect(run.cm360).toBe(69.27);
    expect(run.cfg_key).toBe('69.3');
  });

  it('leaves damage_possible null — it is not a summary key', () => {
    expect(parseStats(AIR, readStats(AIR)).damage_possible).toBeNull();
  });

  it('takes elapsed from the last kill', () => {
    expect(parseStats(AIR, readStats(AIR)).elapsed_s).toBeCloseTo(85.994, 3);
  });

  it('leaves elapsed null when nothing ever dies', () => {
    const run = parseStats(TRACKING, readStats(TRACKING));
    expect(run.elapsed_s).toBeNull();
    expect(run.kills).toBe(0);
  });

  it('reads the counters that only some scenarios use', () => {
    expect(parseStats(AIR, readStats(AIR)).overshots).toBe(100);
    const reload = 'Pasu Voltaic Reload Easier - Challenge - 2026.07.27-16.50.01';
    expect(parseStats(reload, readStats(reload)).reloads).toBe(1);
  });

  it('parses every fixture without throwing', () => {
    for (const id of statsIds()) {
      const run = parseStats(id, readStats(id));
      expect(run.scenario).toBeTruthy();
      expect(run.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

describe('parseKills', () => {
  it('indexes by file order, not by the Kill # column', () => {
    // Happy Easter! writes 0 in Kill # on every row. Indexing on it would
    // collide, and file order is what every consumer actually wants.
    const kills = parseKills(readStats(EASTER));
    expect(kills).toHaveLength(2);
    expect(kills.map((k) => k.idx)).toEqual([1, 2]);
  });

  it('rebases timestamps onto Challenge Start', () => {
    const kills = parseKills(readStats(AIR));
    expect(kills).toHaveLength(5);
    expect(kills[0].t).toBeCloseTo(14.395, 3);
    expect(kills[4].t).toBeCloseTo(85.994, 3);
  });

  it('reads the per-kill columns', () => {
    const kills = parseKills(readStats(AIR));
    expect(kills[0].bot).toBe('AIR1_Short_close');
    expect(kills[0].ttk).toBeCloseTo(14.137001, 6);
    expect(kills[4].bot).toBe('AIR2_Mid_UFO');
    expect(kills[4].ttk).toBeCloseTo(20.050001, 6);
  });

  it('returns nothing for a run whose bots never die', () => {
    expect(parseKills(readStats(TRACKING))).toEqual([]);
  });

  it('sums TTK to fight time', () => {
    // Fight Time == sum(TTK) exactly, and excludes the inter-bot gaps. If this
    // drifts, the race split table stops reconciling.
    const kills = parseKills(readStats(AIR));
    const total = kills.reduce((a, k) => a + (k.ttk ?? 0), 0);
    expect(total).toBeCloseTo(84.948997, 4);
  });
});
