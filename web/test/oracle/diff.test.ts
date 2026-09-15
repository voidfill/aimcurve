import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { getHealth, getRun, getRuns, getScenarios, getSession } from '../../src/core/api';
import { ingest } from '../../src/core/ingest';
import { buildStore } from '../../src/core/memstore';
import type { PayloadOpts } from '../../src/core/payload';
import type { Store } from '../../src/core/store';
import { readPerf, readStats, statsIds } from '../fixtures';
import { compare, normalisePython, report } from './diff';

// Reached with `nix shell nixpkgs#python3 --command python3` on the development
// machine; set AIMCURVE_PYTHON to whatever invokes Python 3 elsewhere. There is
// deliberately no skip: a differential test that passes when it could not reach
// one side reports green over nothing.
const PYTHON = process.env.AIMCURVE_PYTHON ?? 'python3';
// fileURLToPath rather than .pathname: a URL's pathname is percent-encoded, so
// a checkout under a path with a space in it becomes a literal "%20" and the
// spawn fails with ENOENT. Windows players are the target users; a space in the
// path is the normal case there.
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** `dump.ALL`: the ceiling `server.py` puts on ?limit=. */
const ALL = 100_000;

/** The same matrix `dump.run_cases()` walks, spelled with the same literals.
 *  The two documents are joined on this key, so it is written out on both
 *  sides rather than derived -- a key built by formatting a number is one repr
 *  away from lining nothing up while still reporting no differences. */
const CASES: [string, PayloadOpts][] = [
  ['metric=score', { metric: 'score' }],
  ['metric=shots', { metric: 'shots' }],
  ['metric=hits', { metric: 'hits' }],
  ['metric=kills', { metric: 'kills' }],
  ['metric=accuracy', { metric: 'accuracy' }],
  ['metric=efficiency', { metric: 'efficiency' }],
  ['smoothing=0', { smoothing: 0 }],
  ['smoothing=1', { smoothing: 1 }],
  ['smoothing=2', { smoothing: 2 }],
  ['smoothing=3', { smoothing: 3 }],
  ['smoothing=7', { smoothing: 7 }],
  ['recent_n=-5', { recentN: -5 }],
  ['recent_n=0', { recentN: 0 }],
  ['recent_n=1', { recentN: 1 }],
  ['recent_n=3', { recentN: 3 }],
  ['same_cfg=0', { sameCfg: false }],
];

let python: Record<string, any>;
let mine: Record<string, any>;

function dumpFromPython(): Record<string, any> {
  const dir = mkdtempSync(join(tmpdir(), 'aimcurve-oracle-'));
  const out = join(dir, 'oracle.json');
  try {
    try {
      execFileSync(PYTHON, ['-m', 'aimcurve', 'dump', '--root', 'tests/fixtures', '--out', out],
        { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
    } catch (error) {
      // A bare "spawnSync python3 ENOENT" reads like a broken port. Say what
      // failed and how to point it somewhere else -- and then still throw,
      // because this is the half of the comparison that cannot be skipped.
      throw new Error(
        `could not run the Python oracle (${PYTHON} -m aimcurve dump) in ${REPO}. `
        + 'Set AIMCURVE_PYTHON to whatever launches Python 3 here. '
        + `Cause: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error });
    }
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The same document `dump.build` produces, from the TypeScript. */
function dumpFromTypescript(s: Store) {
  const ids = statsIds();

  const runs: Record<string, unknown> = {};
  for (const id of ids) runs[id] = getRun(s, id, {});

  const cases: Record<string, unknown> = {};
  for (const id of ids) {
    for (const [key, opts] of CASES) cases[`${id}|${key}`] = getRun(s, id, opts);
  }

  const rails: Record<string, unknown> = {};
  for (const limit of [0, 1, 5]) rails[`limit=${limit}`] = getRuns(s, { limit });
  rails['same_cfg=0'] = getRuns(s, { limit: ALL, sameCfg: false });
  for (const row of getScenarios(s)) {
    rails[`scenario=${row.scenario}`] = getRuns(s, { limit: ALL, scenario: row.scenario });
  }
  for (const id of ids) rails[`before=${id}`] = getRuns(s, { limit: ALL, before: id });

  // getHealth also answers awaiting_perf and watcher_errors. Both read a live
  // watcher's counters, which the Python dump has no watcher to read and so
  // does not emit; there is nothing on the other side to compare them against.
  const { runs: n, curves, failed, scenarios } = getHealth(s);

  return {
    runs,
    cases,
    rail: getRuns(s, { limit: ALL }),
    rails,
    scenarios: getScenarios(s),
    days: Object.fromEntries(s.days().map((d) => [d, s.day(d)])),
    health: { runs: n, curves, failed, scenarios },
    session: getSession(s),
  };
}

// The timeout is spelled here as well as in vitest.oracle.config.ts because
// `testTimeout` does not govern hooks -- that is `hookTimeout`, ten seconds by
// default -- and all of the work is in this hook.
beforeAll(() => {
  python = normalisePython(dumpFromPython());
  const store = buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id))));
  mine = dumpFromTypescript(store);
}, 120_000);

describe('oracle diff', () => {
  it('reached the Python at all', () => {
    const runs = statsIds().length;
    expect(Object.keys(python.runs)).toHaveLength(runs);
    expect(Object.keys(python.cases)).toHaveLength(runs * CASES.length);
  });

  it('agrees on every run payload', () => {
    const differences = compare(python.runs, mine.runs, 'runs');
    expect(differences.length, `\n${report(differences)}`).toBe(0);
  });

  it('agrees on every run under every option', () => {
    const differences = compare(python.cases, mine.cases, 'cases');
    expect(differences.length, `\n${report(differences)}`).toBe(0);
  });

  it('agrees on the rail', () => {
    const differences = compare(python.rail, mine.rail, 'rail');
    expect(differences.length, `\n${report(differences)}`).toBe(0);
  });

  it('agrees on the rail under every limit, cursor and filter', () => {
    const differences = compare(python.rails, mine.rails, 'rails');
    expect(differences.length, `\n${report(differences)}`).toBe(0);
  });

  it('agrees on the scenario list', () => {
    const differences = compare(python.scenarios, mine.scenarios, 'scenarios');
    expect(differences.length, `\n${report(differences)}`).toBe(0);
  });

  it('agrees on every day', () => {
    const differences = compare(python.days, mine.days, 'days');
    expect(differences.length, `\n${report(differences)}`).toBe(0);
  });

  it('agrees on the health counts', () => {
    const differences = compare(python.health, mine.health, 'health');
    expect(differences.length, `\n${report(differences)}`).toBe(0);
  });

  it('agrees on the default session', () => {
    const differences = compare(python.session, mine.session, 'session');
    expect(differences.length, `\n${report(differences)}`).toBe(0);
  });
});
