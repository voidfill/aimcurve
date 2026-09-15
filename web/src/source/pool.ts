/** Bounded-concurrency reads.
 *
 * Reading is 15 s of the browser design's 22 s bootstrap at 12k runs, and it is
 * the only phase worth parallelising: 0.925 ms/file serial against 0.175 ms at
 * 8 parallel on the machine that was measured.
 *
 * The pool size is deliberately not a constant tuned on one device. High
 * concurrency does not help on a spinning disk or a network-redirected profile,
 * and the measured curve is flat from 8 to 128 -- so the value is chosen from
 * the low end of that flat region, where the gain is already banked and the
 * memory held in flight is smallest. It is not the midpoint of the range, and
 * it is not the fastest observed point.
 */

export const DEFAULT_CONCURRENCY = 12;

/** Run `work` over every item, at most `concurrency` at a time.
 *
 * `work` is called in input order but *completes* in whatever order the reads
 * finish, so a caller that pushes into an array gets completion order, not
 * input order. Sort afterwards if the order matters.
 *
 * The first rejection stops the pool and propagates: the remaining items are
 * left untouched rather than being read into a caller that has already
 * unwound.
 */
export async function readAll<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<void> {
  const width = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      // Without this the other width-1 workers keep draining the list after one
      // of them has thrown -- calling `work` on every remaining item while the
      // caller has already unwound and possibly torn its database down. How
      // much still runs depends on the width, so one unreadable file would give
      // a different partial index at width 1 than at width 2.
      if (failed) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        await work(items[i]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  await Promise.all(workers);
}
