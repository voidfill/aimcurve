/** Choosing a source, building the index, starting the dashboard.
 *
 * Order matters in one place: the database is opened and read *before* any
 * picking, so a returning visitor sees their history immediately rather than
 * being asked for a folder they already chose. The cost of that is that what
 * they see is as old as the last read, which is why the age is reported.
 */

import { createStore } from './db/idbstore';
import { indexInto, pendingIds } from './db/indexer';
import {
  done, META_HANDLE, META_PERSISTED, META_READ_AT, META_ROOT_NAME,
  openDatabase, req, requestPersistence,
} from './db/schema';
import { electWriter } from './db/writer';
import { pickDirectory, pickerSource, supportsPicker } from './source/picker';
import type { RunSource } from './source/types';
import { uploadSource } from './source/upload';
import { useStore } from './ui/api-shim.js';

// app.js is imported dynamically, and that is load-bearing. It does DOM work at
// module evaluation -- `uPlot.sync('kv')` at :194, `ro.observe` at :477,
// loadCtrl()/buildSegs() at :896, a hashchange listener at :828 -- all before
// start() is ever called. A static `import { start } from './ui/app.js'` runs
// every one of those the moment boot.ts is evaluated, which is before main()
// has called useStore(). So the shim must be pointed at a store BEFORE this
// import is awaited, not merely before start() is called.
let ui: typeof import('./ui/app.js') | null = null;
async function loadUi() {
  if (!ui) ui = await import('./ui/app.js');
  return ui;
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The source this tab last read from. Picker sources can be reused directly;
 *  upload snapshots need a new browser gesture and another file selection. */
let current: RunSource | null = null;

let ageTimer: ReturnType<typeof setInterval> | null = null;

async function lastReadAt(db: IDBDatabase): Promise<number | null> {
  const row = await req<{ value: number } | undefined>(
    db.transaction('meta').objectStore('meta').get(META_READ_AT));
  return row?.value ?? null;
}

/** Past which age the UI stops being quiet about it. One place, because Task 9
 *  styles the control off the same threshold the label is computed from. */
export const STALE_MS = 60 * 60_000;

/** The bare age -- 'just now', '5 min ago'. Callers add any prefix, so that the
 *  null case does not have to read "read never". */
function describeAge(readAt: number | null): string {
  if (readAt === null) return 'never';
  const ms = Date.now() - readAt;
  // A clock that moved backwards, or a file written by a machine slightly ahead
  // of this one, gives a negative age. Rounding that would print "-3 min ago";
  // it passed the old `< 2` test and rendered "just now" only by accident.
  if (ms <= 0) return 'just now';
  // floor, not round, everywhere. Rounding made 59 min 40 s print "1 h ago"
  // while the styling -- which compares the raw age against one hour -- still
  // called it fresh, so the label and the colour disagreed for twenty seconds
  // out of every hour.
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** 'read 5 min ago', or 'never read' -- never 'read never'. */
function describeRead(readAt: number | null): string {
  return readAt === null ? 'never read' : `read ${describeAge(readAt)}`;
}

function renderAge(readAt: number | null): void {
  el('repickAge').textContent = describeAge(readAt);
  const stale = readAt !== null && Date.now() - readAt > STALE_MS;
  el('repick').dataset.stale = stale ? '1' : '0';
}

async function showDashboard(db: IDBDatabase): Promise<void> {
  // useStore first, then the import: see the note on loadUi above.
  useStore(createStore(db));
  const { setSnapshotAge, start } = await loadUi();
  // Not `el('app').hidden = false`: the dashboard's elements are direct
  // children of <body> so that the body grid can size them, and a class is
  // what reveals them.
  document.body.classList.remove('picking');
  await start();
  const readAt = await lastReadAt(db);
  setSnapshotAge(describeRead(readAt));
  renderAge(readAt);
  if (ageTimer !== null) clearInterval(ageTimer);
  ageTimer = setInterval(() => renderAge(readAt), 60_000);
}

/** Say something in whichever panel is actually on screen.
 *
 * #status lives in the topbar, which `body.picking` hides -- so a message
 * written there before the dashboard is revealed is written into a hidden
 * element and the user sees nothing at all.
 */
async function announce(message: string): Promise<void> {
  if (document.body.classList.contains('picking')) {
    const progress = el<HTMLParagraphElement>('pickProgress');
    progress.hidden = false;
    progress.textContent = message;
  } else {
    (await loadUi()).setSnapshotAge(message);
  }
}

/** Store a picker handle only after its source has been accepted and indexed. */
async function saveHandle(db: IDBDatabase, handle: FileSystemDirectoryHandle) {
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key: META_HANDLE, value: handle });
  await done(tx);
}

/** A stored handle still needs a permission check after a browser restart. */
async function restoreHandle(db: IDBDatabase): Promise<FileSystemDirectoryHandle | null> {
  const row = await req<{ value: FileSystemDirectoryHandle } | undefined>(
    db.transaction('meta').objectStore('meta').get(META_HANDLE));
  const handle = row?.value;
  if (!handle) return null;
  const opts = { mode: 'read' as const };
  if (await (handle as any).queryPermission(opts) === 'granted') return handle;
  return await (handle as any).requestPermission(opts) === 'granted' ? handle : null;
}

/** Folder names are only a guardrail, but they catch the accidental merge that
 *  otherwise cannot be undone from this UI. */
async function checkSameFolder(db: IDBDatabase, name: string): Promise<boolean> {
  const row = await req<{ value: string } | undefined>(
    db.transaction('meta').objectStore('meta').get(META_ROOT_NAME));
  if (row?.value === undefined || row.value === name) return true;
  return confirm(
    `This index was built from “${row.value}”, and you picked “${name}”.\n\n` +
    `Adding it will merge both installs into one history, permanently. ` +
    `Cancel to keep the existing index.`);
}

/** Two animation frames guarantee the newly revealed privacy copy has painted
 *  before Chrome opens its upload confirmation modal. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function repick(db: IDBDatabase): Promise<void> {
  const handle = current?.kind === 'picker' ? null : await restoreHandle(db);
  if (current?.kind === 'picker') {
    await indexFrom(db, current);
    return;
  }
  if (handle) {
    const source = await pickerSource(handle);
    await indexFrom(db, source);
    if (current === source) await saveHandle(db, handle);
    return;
  }
  document.body.classList.add('picking');
  await afterPaint();
  el<HTMLInputElement>('pickUpload').click();
}

export async function indexFrom(db: IDBDatabase, source: RunSource): Promise<void> {
  if (!await checkSameFolder(db, source.rootName)) return;
  // Not `el('pickProgress')` directly: on a re-index the dashboard is already
  // up and #pick is hidden, so writing there gives a 22-second pass with no
  // feedback whatsoever. `announce` picks whichever panel is on screen.
  await announce('Looking at the folder…');

  const pending = await pendingIds(db, source);
  let last = 0;
  await indexInto(db, source, pending, (p) => {
    // At 12k runs this fires 12,000 times; repainting on every one is most of
    // what makes the pass feel slow. Four times a second is plenty.
    if (p.done !== p.total && Date.now() - last < 250) return;
    last = Date.now();
    void announce(p.phase === 'reading'
      ? `Reading ${p.done} of ${p.total} runs…`
      : p.phase === 'writing'
        ? `Storing ${p.done} of ${p.total}…`
        : `Classifying ${p.done} of ${p.total} scenarios…`);
  });
  if (!pending.length) await announce('Nothing new.');

  // After the first successful bootstrap, not before: asking for persistence
  // with an empty database spends the user's one prompt on nothing.
  const persisted = await requestPersistence();
  const write = db.transaction('meta', 'readwrite');
  write.objectStore('meta').put({ key: META_PERSISTED, value: persisted });
  write.objectStore('meta').put({ key: META_ROOT_NAME, value: source.rootName });
  await done(write);

  current = source;

  await showDashboard(db);
}

export async function main(): Promise<void> {
  const db = await openDatabase();
  const writer = await electWriter();
  const store = createStore(db);
  const counts = await store.counts();

  // A returning visit renders immediately. The index is a cache with no source
  // attached, so it is shown with its age rather than withheld.
  if (counts.runs > 0) {
    await showDashboard(db);
  }

  const fail = async (message: string) => {
    if (!document.body.classList.contains('picking')) {
      // Past the first index #pickError is inside the hidden panel, so an error
      // written there is invisible. Say it where the user is looking.
      await announce(message);
      return;
    }
    const error = el<HTMLParagraphElement>('pickError');
    error.hidden = false;
    error.textContent = message;
  };

  el<HTMLButtonElement>('repick').addEventListener('click', () => {
    if (!writer.elected) return;
    void repick(db).catch((e) => fail((e as Error).message));
  });

  if (!writer.elected) {
    // Another tab owns the writing. This one reads, and says so wherever the
    // user is actually looking.
    //
    // Returning here before the controls below are bound is what made an empty
    // database in a second tab a terminal dead end: #pick stayed on screen with
    // a visible folder button that opened the directory dialog and then did
    // nothing at all, for ever, because no change listener had been attached.
    await announce(counts.runs > 0
      ? 'another tab is indexing'
      : 'Another aimcurve tab is indexing this folder. This tab will show your ' +
        'history once that finishes — reload to check.');
    el<HTMLButtonElement>('pickDir').hidden = true;
    el<HTMLLabelElement>('pickUploadLabel').hidden = true;
    return;
  }

  if (supportsPicker()) {
    // Exactly one control, so that "try the folder button below instead" names
    // something distinguishable.
    const button = el<HTMLButtonElement>('pickDir');
    button.hidden = false;
    el<HTMLLabelElement>('pickUploadLabel').hidden = true;
    button.addEventListener('click', async () => {
      const handle = await pickDirectory();
      if (!handle) {
        button.hidden = true;
        el<HTMLLabelElement>('pickUploadLabel').hidden = false;
        return;
      }
      try {
        const source = await pickerSource(handle);
        await indexFrom(db, source);
        if (current === source) await saveHandle(db, handle);
      } catch (e) {
        // Chrome refuses any directory under Program Files, by every route.
        // The upload control is not subject to that, so bring it back and point
        // at it -- the message has to name a control that is actually on screen.
        button.hidden = true;
        el<HTMLLabelElement>('pickUploadLabel').hidden = false;
        await fail(`${(e as Error).message}. Try “Choose folder (upload)” instead.`);
      }
    });
  }

  el<HTMLInputElement>('pickUpload').addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files?.length) return;
    try {
      await indexFrom(db, uploadSource(files));
    } catch (e) {
      await fail((e as Error).message);
    } finally {
      // Chrome fires no `change` when the same directory is chosen twice in a
      // row unless the value is cleared -- and re-picking the same folder is
      // the common case, not the rare one.
      input.value = '';
    }
  });
}

if (!import.meta.env.TEST) {
  void main().catch((e) => {
    const error = document.getElementById('pickError');
    if (error) {
      error.hidden = false;
      error.textContent = String(e);
    }
  });
}
