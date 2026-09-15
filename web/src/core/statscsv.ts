/** Reading `stats/*.csv`.
 *
 * The file is three blocks, not a CSV table: a per-kill matrix, a `Key:,Value`
 * summary, and a `Key:,Value` settings snapshot. Only lines whose key ends in
 * ':' are pairs; everything else in the leading block is a kill row.
 *
 * A port of `aimcurve/statscsv.py`. Where the two could differ, the Python is
 * right.
 */

import type { Kill, Run } from './types';

// cm/360 = C / (DPI * Sens Increment). Empirically derived: across 2083 runs
// whose Sens Scale is literally cm/360, DPI * increment * label is constant to
// 7 significant figures.
export const CM360_CONSTANT = 13062.86;

const FILENAME =
  /^(.+) - Challenge - (\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}) Stats\.csv$/;

// Kill rows are positional, not keyed, so the column order is the contract.
// Verified against a real install: 124 distinct bot names, 16 weapons. The
// file's own `Kill #` column (fields[0]) is NOT used as the row's index --
// "Happy Easter!" writes 0 on every row, which would collide on a PRIMARY KEY
// (run_id, idx). File order is what every consumer actually wants anyway (the
// split table pairs a run's Nth kill against the baseline's Nth kill).
const KILL_COLUMNS = 13;
const CLOCK = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/;

/** The `Run` fields a numeric key may name, and the ones a string key may.
 *
 * Narrower than `keyof Run` on purpose. With the wider type the assignment
 * below needs a cast to a single field name, and a cast is an assertion rather
 * than a check: mis-keying `Score: 'scenario'` would then compile and write a
 * number into a string field. Derived this way, the mistake is caught here, at
 * the table.
 */
type NumberField = { [K in keyof Run]: Run[K] extends number | null ? K : never }[keyof Run];
type StringField = { [K in keyof Run]: Run[K] extends string | null ? K : never }[keyof Run];

const FLOATS: Record<string, NumberField> = {
  Score: 'score',
  'Damage Done': 'damage_done',
  'Avg TTK': 'avg_ttk',
  'Fight Time': 'fight_time',
  'Horiz Sens': 'sens_raw',
  'Sens Increment': 'sens_increment',
  FOV: 'fov',
  'Avg FPS': 'avg_fps',
  'Damage Taken': 'damage_taken',
};
const INTS: Record<string, NumberField> = {
  Kills: 'kills',
  'Hit Count': 'hits',
  'Miss Count': 'misses',
  'Pause Count': 'pause_count',
  DPI: 'dpi',
  'Total Overshots': 'overshots',
  Reloads: 'reloads',
};
const STRINGS: Record<string, StringField> = {
  Scenario: 'scenario',
  Hash: 'hash',
  'Game Version': 'game_version',
  'Sens Scale': 'sens_scale',
  FOVScale: 'fov_scale',
  Resolution: 'resolution',
};

function toNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function toInt(text: string | undefined): number | null {
  const value = toNumber(text);
  // Python's int(float(text)) truncates toward zero, and so does this.
  return value === null ? null : Math.trunc(value);
}

function clockSeconds(text: string): number | null {
  const match = CLOCK.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** A `Fight Time`-style value: seconds with an optional trailing 's'. */
function seconds(text: string | undefined): number | null {
  return toNumber(text?.trim().replace(/s$/, ''));
}

export function cm360(dpi: number | null, sensIncrement: number | null): number | null {
  if (dpi === null || sensIncrement === null) return null;
  const denominator = dpi * sensIncrement;
  if (!denominator) return null;
  return CM360_CONSTANT / denominator;
}

export function parseFilename(
  basename: string,
): { scenario: string; started_at: string } | null {
  const m = FILENAME.exec(basename);
  if (!m) return null;
  return {
    scenario: m[1],
    started_at: `${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}`,
  };
}

/** The per-kill block, with `t` as seconds from Challenge Start.
 *
 * Returns [] for the ~46% of runs whose bots are invincible and never die.
 * The clock in these rows is wall time with no date, so it is rebased onto
 * Challenge Start; a run that crosses midnight would otherwise go negative.
 */
export function parseKills(text: string): Kill[] {
  const rows: string[][] = [];
  let start: number | null = null;

  for (const line of text.split('\n')) {
    const comma = line.indexOf(',');
    if (comma >= 0) {
      const key = line.slice(0, comma);
      if (key === 'Challenge Start:') {
        start = clockSeconds(line.slice(comma + 1));
        continue;
      }
      if (key.endsWith(':')) continue;
    }
    const fields = line.replace(/\r?$/, '').split(',');
    // fields[0] must be all digits: that is what separates a kill row from the
    // block header and from a blank line.
    if (fields.length < KILL_COLUMNS || !/^\d+$/.test(fields[0])) continue;
    rows.push(fields);
  }

  if (start === null) return [];

  const kills: Kill[] = [];
  rows.forEach((fields, i) => {
    const at = clockSeconds(fields[1]);
    if (at === null) return;
    let offset = at - start!;
    if (offset < 0) offset += 86400; // the run crossed midnight
    kills.push({
      idx: i + 1,
      t: offset,
      bot: fields[2],
      weapon: fields[3],
      ttk: seconds(fields[4]),
      shots: toInt(fields[5]),
      hits: toInt(fields[6]),
      dmg_done: toNumber(fields[8]),
      dmg_possible: toNumber(fields[9]),
      overshots: toInt(fields[12]),
    });
  });
  return kills;
}

export function parseStats(id: string, text: string): Run {
  const named = parseFilename(`${id} Stats.csv`);

  const run: Run = {
    id,
    scenario: named?.scenario ?? '',
    started_at: named?.started_at ?? '',
    has_perf: false,
    score: null, kills: null, hits: null, misses: null, shots: null,
    accuracy: null, damage_done: null, damage_possible: null,
    avg_ttk: null, fight_time: null, pause_count: null,
    duration_s: null, spm: null, elapsed_s: null,
    overshots: null, reloads: null, damage_taken: null,
    hash: null, game_version: null,
    sens_raw: null, sens_scale: null, dpi: null, sens_increment: null,
    cm360: null, cfg_key: null,
    fov: null, fov_scale: null, resolution: null, avg_fps: null,
  };

  const set = <K extends keyof Run>(key: K, value: Run[K]) => { run[key] = value; };

  for (const line of text.split('\n')) {
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const rawKey = line.slice(0, comma);
    if (!rawKey.endsWith(':')) continue; // kill row, blank line, or a header
    const key = rawKey.slice(0, -1);
    const value = line.slice(comma + 1).trim();
    if (key in FLOATS) set(FLOATS[key], toNumber(value));
    else if (key in INTS) set(INTS[key], toInt(value));
    else if (key in STRINGS) set(STRINGS[key], value);
  }

  const { hits, misses } = run;
  run.shots = hits !== null && misses !== null ? hits + misses : null;
  run.accuracy = run.shots ? (hits as number) / run.shots : null;

  // Elapsed is the CSV's own answer, not the .perf's: it is exact, it works on
  // the ~1-in-7 runs with no .perf, and for a race scenario it IS the score.
  const kills = parseKills(text);
  run.elapsed_s = kills.length ? kills[kills.length - 1].t : null;

  // damage_possible is not a summary key; it is only in the per-weapon block.
  // The curve carries it, so leave it null rather than guessing.
  run.damage_possible = null;

  const exact = cm360(run.dpi, run.sens_increment);
  run.cm360 = exact === null ? null : Number(exact.toFixed(2));
  // Python formats with round-half-to-even and this rounds half away from
  // zero. A value landing exactly on a tie would disagree; none does in this
  // corpus, and the full-corpus diff is what settles whether any ever does.
  run.cfg_key = exact === null ? null : exact.toFixed(1);
  return run;
}
