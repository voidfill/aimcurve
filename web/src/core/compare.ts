/** Curve arithmetic.
 *
 * Everything here is pure over arrays. The load-bearing property is in
 * `cumulativeDelta`: its final value is exactly the score difference against
 * the baseline, so the chart and the headline number cannot disagree.
 */

export const DEFAULT_RECENT_N = 10;
export const DURATION_TOLERANCE = 0.1;

/** What Python's builtin `sum` does to a run of floats.
 *
 * Since 3.12 it carries a Neumaier compensation term rather than accumulating
 * left to right, so `sum([0.74, 0.85, 0.84, 0.77, 0.71]) / 5` is 0.782 there
 * and 0.7819999999999999 under a naive loop. The oracle sums a float series in
 * every smoothing window and in a handful of payload aggregates, so a naive
 * loop here drifts by an ulp on roughly one rate bucket in ten. The oracle
 * diff compares exactly, so that drift is a failure rather than a rounding
 * detail -- and reproducing the compensation is nine lines.
 */
export function pySum(values: ArrayLike<number>, lo = 0, hi = values.length): number {
  let total = 0;
  let compensation = 0;
  for (let i = lo; i < hi; i++) {
    const x = values[i];
    const t = total + x;
    compensation += Math.abs(total) >= Math.abs(x)
      ? (total - t) + x
      : (x - t) + total;
    total = t;
  }
  return total + compensation;
}

/** What Python's `math.fsum` does to a run of floats.
 *
 * Not the same algorithm as `pySum` and not interchangeable with it. Builtin
 * `sum` carries a single Neumaier compensation term, which is cheap and almost
 * always right; `math.fsum` keeps Shewchuk's full expansion -- a list of
 * non-overlapping partials that together represent the running total exactly --
 * and so returns the correctly rounded sum always. The two differ: over
 * `[1e100, 1, 1e-100, -1e100, -1]` a naive loop gives -1, builtin `sum` gives
 * 0, and `fsum` gives 1e-100.
 *
 * Which one a call site needs is decided by the oracle, not by taste. Python's
 * `statistics.fmean` is `fsum(data) / n`, so every `fmean` in the oracle is a
 * `pyFsum` here; every builtin `sum` is a `pySum`. Short inputs let the two
 * agree by luck, which is exactly how the wrong one survives review -- the band
 * below only ever saw two-value columns until a scenario had three comparable
 * curves.
 *
 * The tail is CPython's, including the half-even fixup: without it
 * `fsum([1e-16, 1, 1e16])` rounds down to 1e16 instead of up to the value two
 * ulps above it, and fsum stops being commutative.
 */
export function pyFsum(values: ArrayLike<number>): number {
  const partials: number[] = [];
  let n = 0;
  // A non-finite intermediate is either overflow (which Python raises on) or an
  // inf/nan that was in the input (which it sums separately, so that an inf
  // among finite values comes back as inf rather than as the nan the expansion
  // would otherwise produce).
  let special = 0;
  let infinities = 0;

  for (let k = 0; k < values.length; k++) {
    let x = values[k];
    const original = x;
    let i = 0;
    for (let j = 0; j < n; j++) {
      let y = partials[j];
      if (Math.abs(x) < Math.abs(y)) { const t = x; x = y; y = t; }
      const high = x + y;
      const low = y - (high - x);
      if (low !== 0) partials[i++] = low;
      x = high;
    }
    n = i;
    if (x !== 0) {
      if (!Number.isFinite(x)) {
        if (Number.isFinite(original)) throw new RangeError('intermediate overflow in fsum');
        if (Math.abs(original) === Infinity) infinities += original;
        special += original;
        n = 0;
      } else {
        partials[n++] = x;
      }
    }
  }

  // `!== 0` rather than a finiteness test on purpose: a nan special sum is not
  // equal to zero either, and a nan anywhere in the input must come back out.
  if (special !== 0) {
    if (Number.isNaN(infinities)) throw new RangeError('-inf + inf in fsum');
    return special;
  }

  let total = 0;
  if (n > 0) {
    total = partials[--n];
    // Add the partials from the top down, stopping at the first one that does
    // not fit: everything below it is strictly smaller than half an ulp of the
    // total, so it can only move the result by tipping a tie.
    let low = 0;
    while (n > 0) {
      const x = total;
      const y = partials[--n];
      total = x + y;
      low = y - (total - x);
      if (low !== 0) break;
    }
    if (n > 0 && ((low < 0 && partials[n - 1] < 0) || (low > 0 && partials[n - 1] > 0))) {
      const y = low * 2;
      const x = total + y;
      if (y === x - total) total = x;
    }
  }
  return total;
}

/** Centred rolling mean. Preserves length; shrinks the window at the edges. */
export function smooth(values: readonly number[], window: number): number[] {
  if (window <= 1 || !values.length) return Array.from(values);
  const half = Math.floor(window / 2);
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length, i + half + 1);
    out.push(pySum(values, lo, hi) / (hi - lo));
  }
  return out;
}

/** Zero-extend both to the longer length. */
export function pad(
  a: readonly number[], b: readonly number[],
): [number[], number[]] {
  const n = Math.max(a.length, b.length);
  const grow = (xs: readonly number[]) =>
    Array.from(xs).concat(new Array(n - xs.length).fill(0));
  return [grow(a), grow(b)];
}

/** Running sum of (mine - base).
 *
 * Pads rather than truncates, and that choice is load-bearing. The final value
 * must equal sum(mine) - sum(base) exactly, because the score series sums to
 * the run's score -- so the last point of this curve IS the score difference.
 * Truncating breaks that on ~6% of real runs, where the two differ in length.
 */
export function cumulativeDelta(
  mine: readonly number[], base: readonly number[],
): number[] {
  const [m, b] = pad(mine, base);
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < m.length; i++) {
    total += m[i] - b[i];
    out.push(total);
  }
  return out;
}

/** Index past which only one curve has data, for marking the tail. */
export function compareUntil(mine: readonly number[], base: readonly number[]): number {
  return Math.min(mine.length, base.length);
}

export interface Band {
  mean: number[];
  lo: number[];
  hi: number[];
}

/** Per-bucket mean and +-1 sigma across a set of equal-ish curves. */
export function band(curves: readonly (readonly number[])[]): Band {
  const usable = curves.filter((c) => c.length);
  if (!usable.length) return { mean: [], lo: [], hi: [] };
  const n = Math.min(...usable.map((c) => c.length));
  // Under three curves a standard deviation is noise pretending to be a
  // confidence band, so the band collapses onto the mean.
  const banded = usable.length >= 3;
  const mean: number[] = [];
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < n; i++) {
    const column = usable.map((c) => c[i]);
    // `statistics.fmean` in the Python, which is `math.fsum(column) / n`.
    const mu = pyFsum(column) / column.length;
    // `statistics.pstdev` is Fraction-exact and no float algorithm reproduces
    // it -- `pyFsum` no better than `pySum`, so the choice below is arbitrary
    // rather than matched. This is the one place the oracle diff may eventually
    // need a tolerance, and it needs three comparable prior curves to reach.
    const sigma = banded
      ? Math.sqrt(pySum(column.map((v) => (v - mu) ** 2)) / column.length)
      : 0;
    mean.push(mu);
    lo.push(mu - sigma);
    hi.push(mu + sigma);
  }
  return { mean, lo, hi };
}

// 40 cells per bot: 200-320 points against the ~60-125 native one-second
// buckets, so the grid never invents detail the source cannot support, and
// every kill boundary lands on an exact index rather than between two.
export const RACE_STEPS_PER_BOT = 40;

export function raceGrid(bots: number | null): number {
  return Math.max(1, Math.trunc(bots || 1)) * RACE_STEPS_PER_BOT;
}

/** (edges, rate) on a uniform cumulative-damage grid.
 *
 * `edges[k]` is the time at which the run had done `k/steps` of the damage
 * pool; `rate[k]` is the damage per second within cell k. Indexing by damage
 * rather than by seconds is what makes two runs comparable: kill k always sits
 * at damage `k * pool/bots`, so the boundaries coincide in every run.
 */
export function resampleRace(
  hits: ArrayLike<number>, elapsedS: number, steps: number,
): [number[], number[]] {
  const cumulative: number[] = [];
  let total = 0;
  for (let i = 0; i < hits.length; i++) {
    total += hits[i];
    cumulative.push(total);
  }
  if (!cumulative.length || total <= 0 || !elapsedS) return [[], []];

  const timeAt = (target: number): number => {
    let previous = 0;
    for (let i = 0; i < cumulative.length; i++) {
      const reached = cumulative[i];
      if (reached >= target) {
        const span = reached - previous;
        // bucket i covers [i, i+1); interpolate inside it
        return i + (span > 0 ? (target - previous) / span : 0);
      }
      previous = reached;
    }
    return cumulative.length;
  };

  let edges: number[] = [];
  for (let k = 0; k <= steps; k++) edges.push(timeAt((total * k) / steps));
  // Anchor to the CSV's elapsed. The curve is bucketed to whole seconds, so its
  // own last edge is a rounded approximation -- and for a race that error would
  // land straight in the score difference.
  const span = edges[edges.length - 1];
  if (span > 0) edges = edges.map((e) => (e / span) * elapsedS);

  const cell = total / steps;
  const rate: number[] = [];
  for (let k = 0; k < steps; k++) {
    rate.push(cell / Math.max(edges[k + 1] - edges[k], 1e-6));
  }
  return [edges, rate];
}

/** Seconds gained (+) or lost (-) against the baseline, by progress.
 *
 * The final value is `base_elapsed - mine_elapsed`, which for a race is the
 * score difference to within the CSV's timestamp resolution (+-0.02 s). It is
 * not exact the way cumulativeDelta is: elapsed is derived from a kill
 * timestamp printed to three decimals, while `score` carries the game's own
 * full-precision clock.
 */
export function raceDelta(
  mineEdges: readonly number[], baseEdges: readonly number[],
): number[] {
  const n = Math.min(mineEdges.length, baseEdges.length);
  const out: number[] = [];
  for (let i = 1; i < n; i++) out.push(baseEdges[i] - mineEdges[i]);
  return out;
}
