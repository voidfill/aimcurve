/** Comparing two JSON documents field by field.
 *
 * Numbers compare exactly -- `Object.is`, not a tolerance. A tolerance here
 * would be a licence for drift: the whole document already agrees to the last
 * bit, and the two bugs this port has actually shipped were both one-ulp
 * (a `sum()` that had to be Python's left-to-right order, and a mean that had
 * to divide once rather than accumulate). A 1e-12 window hides exactly those
 * and nothing else.
 *
 * The one field that could ever legitimately need a tolerance is
 * `rate.band.lo` / `rate.band.hi`: the Python's `statistics.pstdev` works in
 * `Fraction` and rounds once at the end, and no float algorithm reproduces
 * that in general. It takes three comparable prior curves for a band to have
 * a standard deviation at all, and this corpus has no scenario with three --
 * so the case is unreachable here. If it ever becomes reachable, the answer is
 * an exact-rational stdev on the port, not a window on this comparison.
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
    if (pk.join(',') !== tk.join(',')) {
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

/** Rewrite a Python-side document so that only real disagreements remain.
 *
 * Two normalisations, and only two -- see the plan. `ids` maps the Python's
 * row counters onto basenames, and the absolute paths a browser cannot have
 * are dropped.
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
