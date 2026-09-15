/** Unit tests for the oracle harness's own comparator.
 *
 * It lives in `test/oracle/` but is tested from out here, because
 * `vitest.config.ts` excludes that directory from `npm test` -- it holds the
 * differential run, which needs a Python the browser app's toolchain has no
 * reason to provide. None of this file needs Python, and all of it needs to run
 * on every commit: `compare` is the project's exit criterion, and a comparator
 * that returned `[]` unconditionally would have kept all nine differential
 * tests green while proving nothing at all.
 */

import { describe, expect, it } from 'vitest';
import { compare, normalisePython, report } from './oracle/diff';

describe('compare', () => {
  it('finds nothing between two identical documents', () => {
    const doc = { a: [1, 2, { b: 'x', c: null }], d: 0.5 };
    expect(compare(doc, structuredClone(doc))).toEqual([]);
  });

  it('catches a one-ulp difference, which is the whole reason it exists', () => {
    // Both of this port's shipped bugs were exactly this size. A tolerance of
    // any width at all would have passed them.
    const differences = compare({ mean: 0.782 }, { mean: 0.7819999999999999 });
    expect(differences).toEqual([
      { path: 'mean', python: 0.782, typescript: 0.7819999999999999 },
    ]);
  });

  it('catches -0 against 0, and says so', () => {
    // `Object.is`, not `===`: the Python prints -0.0 for a bucket that lost
    // exactly as many points as it gained, and a port that rounds the sign away
    // is a port that disagrees with the oracle.
    const differences = compare({ delta: -0 }, { delta: 0 });
    expect(differences).toHaveLength(1);
    expect(Object.is(differences[0].python, -0)).toBe(true);
    expect(report(differences)).toContain('python: -0');
    expect(report(differences)).toContain('ts:     0');
  });

  it('catches null standing in for a number', () => {
    expect(compare({ score: null }, { score: 0 })).toEqual([
      { path: 'score', python: null, typescript: 0 },
    ]);
  });

  it('catches a number written as a string', () => {
    // JSON round-trips both, and `==` would not tell them apart.
    expect(compare({ score: 1200 }, { score: '1200' })).toEqual([
      { path: 'score', python: 1200, typescript: '1200' },
    ]);
  });

  it('catches an array that is the wrong length', () => {
    const differences = compare({ curve: [1, 2, 3] }, { curve: [1, 2] });
    expect(differences).toEqual([
      { path: 'curve', python: [1, 2, 3], typescript: [1, 2] },
    ]);
  });

  it('catches an array in the wrong order', () => {
    // The rail is an ordering as much as a set: same rows, wrong sort, and the
    // dashboard shows the wrong run as most recent.
    expect(compare([1, 2], [2, 1], 'rail')).toEqual([
      { path: 'rail[0]', python: 1, typescript: 2 },
      { path: 'rail[1]', python: 2, typescript: 1 },
    ]);
  });

  it('catches an array where an object should be', () => {
    expect(compare({ rows: [] }, { rows: {} })).toEqual([
      { path: 'rows', python: [], typescript: {} },
    ]);
  });

  it('catches a key the TypeScript does not emit', () => {
    expect(compare({ a: 1, b: 2 }, { a: 1 })).toEqual([
      { path: '{keys}', python: ['a', 'b'], typescript: ['a'] },
    ]);
  });

  it('catches a key the TypeScript emits and the Python does not', () => {
    // Both directions: a comparison that only walks the Python's keys passes
    // over every field the port invented.
    expect(compare({ a: 1 }, { a: 1, b: 2 })).toEqual([
      { path: '{keys}', python: ['a'], typescript: ['a', 'b'] },
    ]);
  });

  it('does not let a comma in a key alias two different key sets', () => {
    // Rail keys are built from scenario names, which come out of a filename the
    // game wrote. Joining the key lists with a comma made these two equal.
    const differences = compare({ 'a,b': 1 }, { a: 1, b: 1 });
    expect(differences).toEqual([
      { path: '{keys}', python: ['a,b'], typescript: ['a', 'b'] },
    ]);
  });

  it('names the field it disagreed about, all the way down', () => {
    const differences = compare(
      { runs: { r1: { delta: { curve: [0, { lo: 1 }] } } } },
      { runs: { r1: { delta: { curve: [0, { lo: 2 }] } } } },
    );
    expect(differences.map((d) => d.path)).toEqual(['runs.r1.delta.curve[1].lo']);
  });

  it('keeps walking after the first difference', () => {
    // A harness that stopped at the first one would report a single ulp and
    // hide the three thousand behind it.
    expect(compare({ a: 1, b: 2 }, { a: 9, b: 8 })).toHaveLength(2);
  });
});

describe('report', () => {
  it('stops at forty differences', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      path: `p${i}`, python: i, typescript: i + 1,
    }));
    expect(report(many).split('\n')).toHaveLength(40 * 3);
  });

  it('renders a negative zero nested inside a dumped array', () => {
    // Arrays reach the report whole whenever the lengths disagree, so the sign
    // has to survive the recursion too, not just the leaf case.
    expect(report([{ path: 'curve', python: [1, -0], typescript: [1] }]))
      .toContain('python: [1,-0]');
  });
});

describe('normalisePython', () => {
  /** A dump document in miniature: one run, one case, every id-bearing field. */
  const doc = {
    ids: { 1: 'run-a', 2: 'run-b' },
    runs: {
      1: {
        run: { id: 1, stats_file: '/home/p/run-a.csv', perf_file: '/home/p/run-a-perf.csv', score: 1200 },
        delta: { baseline: { run_id: 2, score: 1100 } },
        baselines: { true_pb: { run_id: 2 }, pb: { run_id: 2 }, recent: { n: 1 } },
      },
    },
    cases: {
      'run-a|metric=score': {
        run: { id: 1, stats_file: '/home/p/run-a.csv', perf_file: null, score: 1200 },
        delta: { baseline: null },
        baselines: { true_pb: null, pb: null, recent: { n: 0 } },
      },
    },
    rail: [{ id: 2, score: 1100 }],
    rails: { 'limit=1': [{ id: 1, score: 1200 }] },
    scenarios: [{ scenario: 'Air Pure Medium', runs: 2 }],
    days: { '2026-09-03': [{ id: 1, score: 1200 }] },
    health: { runs: 2, curves: 1, failed: 0, scenarios: 1 },
    session: { day: '2026-09-03', runs: [{ id: 1 }, { id: 2 }] },
  };

  it('renames every run id onto the basename the browser keys on', () => {
    const out = normalisePython(structuredClone(doc)) as any;
    expect(Object.keys(out.runs)).toEqual(['run-a']);
    expect(out.runs['run-a'].run.id).toBe('run-a');
    expect(out.runs['run-a'].delta.baseline.run_id).toBe('run-b');
    expect(out.runs['run-a'].baselines.true_pb.run_id).toBe('run-b');
    expect(out.runs['run-a'].baselines.pb.run_id).toBe('run-b');
    expect(out.rail).toEqual([{ id: 'run-b', score: 1100 }]);
    expect(out.rails['limit=1']).toEqual([{ id: 'run-a', score: 1200 }]);
    expect(out.days['2026-09-03']).toEqual([{ id: 'run-a', score: 1200 }]);
    expect(out.session.runs.map((r: any) => r.id)).toEqual(['run-a', 'run-b']);
  });

  it('drops the absolute paths a browser cannot have, and only those', () => {
    const out = normalisePython(structuredClone(doc)) as any;
    expect(out.runs['run-a'].run).toEqual({ id: 'run-a', score: 1200, has_perf: true });
    expect(out.cases['run-a|metric=score'].run.has_perf).toBe(false);
  });

  it('leaves the keys that are already basenames alone', () => {
    // `cases` and `rails` are keyed by the dump, not by a row counter.
    const out = normalisePython(structuredClone(doc)) as any;
    expect(Object.keys(out.cases)).toEqual(['run-a|metric=score']);
    expect(out.scenarios).toEqual(doc.scenarios);
    expect(out.health).toEqual(doc.health);
  });

  it('refuses an id the dump never named', () => {
    // Silently passing an unmapped id through would join the two documents on a
    // key that matches nothing, and a comparison that lines nothing up reports
    // no differences.
    const broken = structuredClone(doc);
    broken.rail = [{ id: 99, score: 1 }];
    expect(() => normalisePython(broken)).toThrow(/no basename for python id 99/);
  });

  it('round-trips a normalised document against itself', () => {
    expect(compare(normalisePython(structuredClone(doc)), normalisePython(structuredClone(doc))))
      .toEqual([]);
  });
});
