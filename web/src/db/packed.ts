/** One record per run, not one per kill.
 *
 * 298,653 individual kill records took 28,354 ms to write on the design's 12k
 * corpus; the same data packed into 8,875 records took 756 ms, and reads
 * faster too. Per-kill rows look reasonable at 2,000 runs and fall off a cliff
 * at 12,000.
 *
 * Numeric fields are Float64Array with NaN standing for null. Float64 rather
 * than Float32 because the Python stores these as SQLite REAL, and the one
 * place a rounding difference would be invisible is exactly here.
 */

import type { Kill } from '../core/types';

export interface PackedKills {
  run_id: string;
  n: number;
  t: Float64Array;
  ttk: Float64Array;
  shots: Float64Array;
  hits: Float64Array;
  overshots: Float64Array;
  dmg_done: Float64Array;
  dmg_possible: Float64Array;
  bots: string[];
  weapons: string[];
}

const NUMERIC = [
  't', 'ttk', 'shots', 'hits', 'overshots', 'dmg_done', 'dmg_possible',
] as const;

const toCell = (v: number | null): number => (v === null ? NaN : v);
const fromCell = (v: number): number | null => (Number.isNaN(v) ? null : v);

export function pack(runId: string, kills: readonly Kill[]): PackedKills {
  const n = kills.length;
  const packed = {
    run_id: runId,
    n,
    bots: kills.map((k) => k.bot),
    weapons: kills.map((k) => k.weapon),
  } as PackedKills;
  for (const field of NUMERIC) {
    const column = new Float64Array(n);
    for (let i = 0; i < n; i++) column[i] = toCell(kills[i][field]);
    packed[field] = column;
  }
  return packed;
}

export function unpack(packed: PackedKills): Kill[] {
  const kills: Kill[] = [];
  for (let i = 0; i < packed.n; i++) {
    kills.push({
      // idx is the position plus one, which is what parseKills assigns: the
      // file's own Kill # column is 0 on every row in at least one scenario.
      idx: i + 1,
      t: packed.t[i],
      bot: packed.bots[i],
      weapon: packed.weapons[i],
      ttk: fromCell(packed.ttk[i]),
      shots: fromCell(packed.shots[i]),
      hits: fromCell(packed.hits[i]),
      overshots: fromCell(packed.overshots[i]),
      dmg_done: fromCell(packed.dmg_done[i]),
      dmg_possible: fromCell(packed.dmg_possible[i]),
    });
  }
  return kills;
}
