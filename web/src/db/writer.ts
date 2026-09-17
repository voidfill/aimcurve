/** One writer per origin, elected with Web Locks.
 *
 * Two tabs would otherwise both index and both read-modify-write the
 * maintained aggregates -- the scenario records and the materialised marks --
 * and a lost update there does not self-heal, because those are maintained
 * rather than derived on read.
 *
 * The loser is not broken: it reads the same database and sees the winner's
 * writes. It simply does not write -- until the winner goes away, at which
 * point it is promoted and takes over. `elected` is therefore a live flag, not
 * a snapshot taken at boot.
 */

const LOCK = 'aimcurve-writer';

export interface Writer {
  /** Whether this tab holds the write lock *now*. False for a tab that lost,
   *  and true from the moment it is promoted. Read it, do not cache it. */
  readonly elected: boolean;
  subscribe(listener: () => void): () => void;
  release(): void;
}

/** Try to become the writer, without waiting for another tab to finish. */
export function electWriter(): Promise<Writer> {
  let elected = false;
  let release = () => {};
  const listeners = new Set<() => void>();
  const writer: Writer = {
    get elected() { return elected; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    release() { release(); elected = false; },
  };

  if (!navigator.locks) {
    // Fail closed: a reader, not a writer.
    //
    // The trigger is a non-secure context -- navigator.locks is undefined over
    // plain http://, which is exactly how this static build gets served off
    // another machine on a LAN. It is not a browser-age problem: Safari 15.4+
    // and Firefox 96+ both ship Web Locks.
    //
    // Electing every tab here would guarantee the lost update this module
    // exists to prevent, rather than merely risking it. A degraded read-only
    // tab is the better failure; serve over https:// or localhost to write.
    return Promise.resolve(writer);
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = () => { if (!settled) { settled = true; resolve(writer); } };

    // Holding the lock for the life of the tab is the point: releasing it after
    // the bootstrap would let a second tab start writing while this one is
    // still reading its own aggregates.
    const hold = () => new Promise<void>((r) => { release = r; });

    navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
      if (lock === null) {
        // Lost. Start as a reader immediately rather than blocking boot behind
        // the winner's bootstrap, then queue for the lock so that closing the
        // winner promotes this tab. Without this second request the survivor of
        // two tabs is read-only for ever -- and on a fresh origin that is an
        // empty dashboard that never fills, no matter how long it is left open.
        settle();
        navigator.locks.request(LOCK, () => {
          elected = true;
          for (const listener of listeners) listener();
          return hold();
        }).catch(() => { /* promotion is best-effort; stay a reader */ });
        return Promise.resolve();
      }
      elected = true;
      settle();
      return hold();
    }).catch(settle);
    // request() rejects when the document is not fully active, on an opaque
    // origin, and on InvalidStateError. Its promise is separate from the
    // callback, so without that .catch the returned promise never settles at
    // all and boot hangs on a blank shell with the rejection only in console.
  });
}
