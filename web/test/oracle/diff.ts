/** Comparing two JSON documents field by field.
 *
 * Numbers compare exactly -- `Object.is`, not a tolerance. A tolerance here
 * would be a licence for drift: the whole document already agrees to the last
 * bit, and the two bugs this port has actually shipped were both one-ulp
 * (a `sum()` that had to be Python's left-to-right order, and a mean that had
 * to divide once rather than accumulate). A 1e-12 window hides exactly those
 * and nothing else.
 *
 * The one thing left that could ever legitimately need a tolerance is the
 * sigma inside `rate.band.lo` / `rate.band.hi`. Not the mean beside it:
 * `statistics.fmean` is `fsum(column) / n`, and `pyFsum` reproduces it bit for
 * bit. But `statistics.pstdev` sums the squared deviations exactly in
 * `Fraction` before anything reaches a float, and no float algorithm
 * reproduces that in general. It takes three comparable prior curves for a
 * band to have a standard deviation at all, and no scenario in this corpus has
 * more than two -- so the case is unreachable here. If it ever becomes
 * reachable, the answer is an exact-rational stdev on the port, not a window
 * on this comparison.
 */

export interface Difference {
  path: string;
  python: unknown;
  typescript: unknown;
}

export function compare(
  python: unknown, typescript: unknown, path = '', out: Difference[] = [],
): Difference[] {
  if (typeof python === 'number' && typeof typescript === 'number') {
    if (!Object.is(python, typescript)) out.push({ path, python, typescript });
    return out;
  }
  if (Array.isArray(python) || Array.isArray(typescript)) {
    if (!Array.isArray(python) || !Array.isArray(typescript)
      || python.length !== typescript.length) {
      out.push({ path, python, typescript });
      return out;
    }
    python.forEach((v, i) => compare(v, typescript[i], `${path}[${i}]`, out));
    return out;
  }
  if (python && typescript && typeof python === 'object' && typeof typescript === 'object') {
    const pk = Object.keys(python as object).sort();
    const tk = Object.keys(typescript as object).sort();
    // JSON.stringify rather than join(','): the rail is keyed on scenario
    // names, which are whatever the game wrote into a filename, and a comma in
    // one of them makes {"a,b": x} and {"a": x, "b": y} compare equal.
    if (JSON.stringify(pk) !== JSON.stringify(tk)) {
      out.push({ path: `${path}{keys}`, python: pk, typescript: tk });
      return out;
    }
    for (const key of pk) {
      compare(
        (python as Record<string, unknown>)[key],
        (typescript as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        out,
      );
    }
    return out;
  }
  if (python !== typescript) out.push({ path, python, typescript });
  return out;
}

/** `JSON.stringify`, except that a negative zero renders as `-0`.
 *
 * `Object.is(0, -0)` is false, so `compare` reports a sign-of-zero divergence
 * and the Python does emit `-0.0` -- but `JSON.stringify(-0)` is "0", so the
 * report read "python: 0 / ts: 0". Two identical-looking values is the one
 * failure message a legibility harness cannot afford. Recursive because a
 * length or type mismatch dumps a whole array or object, not just a leaf.
 */
function render(value: unknown): string {
  if (Object.is(value, -0)) return '-0';
  if (Array.isArray(value)) return `[${value.map(render).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([key, v]) => `${JSON.stringify(key)}:${render(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** How many differences a failure prints. Enough to see a pattern, few enough
 *  that the first one is still on screen. */
const REPORTED = 40;

/** The differences as something a human reads, capped so it stays readable.
 *
 * Lives here rather than in the test because it is what a failure actually
 * shows: the assertions compare a bounded value and pass this as the message,
 * so that vitest renders `REPORTED` formatted lines instead of its own diff of
 * a 258 KB array with the message scrolled off the top.
 */
export function report(differences: Difference[]): string {
  return differences
    .slice(0, REPORTED)
    .map((d) => `  ${d.path}\n    python: ${render(d.python)}\n    ts:     ${render(d.typescript)}`)
    .join('\n');
}

/** Rewrite a Python-side document so that only real disagreements remain.
 *
 * Three changes, and only three -- see the plan. `ids` maps the Python's row
 * counters onto basenames; the absolute `stats_file` and `perf_file` a browser
 * cannot have are dropped; and `has_perf` is derived from `perf_file` on the
 * way out.
 *
 * That third one is a translation rather than a drop, which makes it the one
 * that could mask a real bug: it asserts that `perf_file is not None` and
 * `has_perf` mean the same thing. Today they do -- `index.attach_perf` writes
 * the path only once the curve has decoded -- but if that ever stops holding,
 * the two sides disagree about which runs are drawable and this comparison
 * still reports nothing.
 */
export function normalisePython(
  doc: Record<string, any>,
): Record<string, unknown> {
  const ids: Record<string, string> = doc.ids;
  const name = (rowId: number | string): string => {
    const mapped = ids[String(rowId)];
    if (mapped === undefined) throw new Error(`no basename for python id ${rowId}`);
    return mapped;
  };

  const run = (r: Record<string, any>) => {
    const { stats_file, perf_file, id, ...rest } = r;
    return { ...rest, id: name(id), has_perf: perf_file !== null };
  };

  /** One run payload, with every run id in it renamed. */
  const runPayload = (payload: Record<string, any>) => {
    // Annotated: spreading an index-signature type and then adding a known key
    // narrows the result to just that key, and every `p.delta` below becomes a
    // type error on a value that is plainly there.
    const p: Record<string, any> = { ...payload, run: run(payload.run) };
    if (p.delta.baseline) {
      p.delta = { ...p.delta, baseline: { ...p.delta.baseline, run_id: name(p.delta.baseline.run_id) } };
    }
    p.baselines = { ...p.baselines };
    if (p.baselines.true_pb) {
      p.baselines.true_pb = { ...p.baselines.true_pb, run_id: name(p.baselines.true_pb.run_id) };
    }
    if (p.baselines.pb) {
      p.baselines.pb = { ...p.baselines.pb, run_id: name(p.baselines.pb.run_id) };
    }
    return p;
  };

  const rows = (list: any[]) => list.map((r) => ({ ...r, id: name(r.id) }));

  const runs: Record<string, unknown> = {};
  for (const [rowId, payload] of Object.entries<any>(doc.runs)) {
    runs[name(rowId)] = runPayload(payload);
  }

  // `cases` and `rails` are already keyed on the basename by the dump, because
  // the browser has no row counter to key on and `before=` is a run id.
  const cases: Record<string, unknown> = {};
  for (const [key, payload] of Object.entries<any>(doc.cases)) {
    cases[key] = runPayload(payload);
  }

  const rails: Record<string, unknown> = {};
  for (const [key, list] of Object.entries<any[]>(doc.rails)) rails[key] = rows(list);

  return {
    runs,
    cases,
    rail: rows(doc.rail),
    rails,
    scenarios: doc.scenarios,
    days: Object.fromEntries(
      Object.entries<any[]>(doc.days).map(([day, list]) => [day, rows(list)]),
    ),
    health: doc.health,
    session: { day: doc.session.day, runs: rows(doc.session.runs) },
  };
}
