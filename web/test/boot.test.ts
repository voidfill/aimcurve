import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSource } from '../src/source/types';

const state = vi.hoisted(() => ({
  persisted: false,
  startSawPersisted: false,
  pickerHandle: null as FileSystemDirectoryHandle | null,
  runs: 0,
  meta: new Map<string, unknown>(),
  indexCalls: [] as RunSource[],
  failingRoots: new Set<string>(),
  confirmResult: true,
  confirmMessages: [] as string[],
  frames: [] as FrameRequestCallback[],
  paintedFrames: 0,
  clicks: [] as Array<{ id: string; paintedFrames: number; picking: boolean }>,
  reloads: 0,
  uiLoaded: false,
  storeReady: false,
  uiSawStore: false,
  starts: 0,
  recoveries: 0,
  startSawRecovery: false,
  indexGate: null as Promise<void> | null,
  inaccessibleHandles: new Set<string>(),
  promoteDuringCounts: false,
  promotions: [] as (() => void)[],
  writer: { elected: true, release() {}, subscribe(fn: () => void) { state.promotions.push(fn); } },
}));

function source(kind: RunSource['kind'], rootName: string): RunSource {
  return {
    kind,
    rootName,
    pickedAt: Date.now(),
    list: async () => [],
    read: async () => ({}),
  };
}

vi.mock('../src/db/idbstore', () => ({
  createStore: () => ({
    counts: async () => {
      if (state.promoteDuringCounts) { state.writer.elected = true; state.promoteDuringCounts = false; }
      return { runs: state.runs, curves: 0, failed: 0, scenarios: 0 };
    },
  }),
}));

vi.mock('../src/db/indexer', () => ({
  pendingClassification: async () => state.meta.get('pending_scenarios') ?? [],
  indexInto: async (_db: IDBDatabase, picked: RunSource) => {
    state.indexCalls.push(picked);
    await state.indexGate;
    if (state.failingRoots.has(picked.rootName)) throw new Error('index failed');
    state.meta.set('read_at', Date.now());
    return { runs: 0, curves: 0, failed: 0, skipped: 0 };
  },
  recoverClassification: async () => {
    state.recoveries++;
    state.meta.set('pending_scenarios', []);
  },
}));

vi.mock('../src/db/schema', () => ({
  META_READ_AT: 'read_at',
  META_PERSISTED: 'persisted',
  META_HANDLE: 'handle',
  META_ROOT_NAME: 'root_name',
  META_PENDING_SCENARIOS: 'pending_scenarios',
  openDatabase: async () => fakeDatabase,
  req: async (request: { result: unknown }) => request.result,
  requestPersistence: async () => true,
  done: async (transaction: { commit(): Promise<void> }) => transaction.commit(),
}));

vi.mock('../src/db/writer', () => ({
  electWriter: async () => state.writer,
}));

vi.mock('../src/source/picker', () => ({
  supportsPicker: () => true,
  pickDirectory: async () => state.pickerHandle,
  pickerSource: async (handle: FileSystemDirectoryHandle) => {
    if (state.inaccessibleHandles.has(handle.name)) throw new Error('folder unavailable');
    return source('picker', handle.name);
  },
}));

vi.mock('../src/source/upload', () => ({
  uploadSource: () => source('upload', 'UploadInstall'),
}));

vi.mock('../src/ui/api-shim.js', () => ({
  useStore: () => { state.storeReady = true; },
}));

vi.mock('../src/ui/app.js', () => {
  state.uiLoaded = true;
  state.uiSawStore = state.storeReady;
  return {
  start: async () => {
    state.starts++;
    state.startSawRecovery = state.recoveries > 0;
    state.startSawPersisted = state.persisted;
  },
  setSnapshotAge: (label: string) => { element('status').textContent = label; },
}; });

class ClassList {
  private names = new Set<string>();

  constructor(...names: string[]) { names.forEach((name) => this.names.add(name)); }
  add(name: string) { this.names.add(name); }
  remove(name: string) { this.names.delete(name); }
  contains(name: string) { return this.names.has(name); }
}

class FakeElement extends EventTarget {
  hidden = false;
  disabled = false;
  textContent: string | null = null;
  value = '';
  files: FileList | null = null;
  dataset: Record<string, string> = {};
  classList = new ClassList();

  constructor(readonly id: string) { super(); }

  click() {
    state.clicks.push({
      id: this.id,
      paintedFrames: state.paintedFrames,
      picking: body.classList.contains('picking'),
    });
    this.dispatchEvent(new Event('click'));
  }
}

const ids = [
  'pickProgress', 'pickError', 'repick', 'repickAge', 'pickDir', 'pickUploadLabel',
  'pickUpload', 'status',
];
let elements = new Map<string, FakeElement>();
let body: FakeElement;

function element(id: string): FakeElement {
  const found = elements.get(id);
  if (!found) throw new Error(`no test element: ${id}`);
  return found;
}

const fakeDatabase = {
  transaction() {
    const writes: Array<{ key: string; value: unknown }> = [];
    return {
      objectStore() {
        return {
          get(key: string) {
            return {
              result: state.meta.has(key)
                ? { key, value: state.meta.get(key) }
                : undefined,
            };
          },
          put(row: { key: string; value: unknown }) { writes.push(row); },
        };
      },
      async commit() {
        await Promise.resolve();
        for (const row of writes) {
          state.meta.set(row.key, row.value);
          if (row.key === 'persisted') state.persisted = row.value as boolean;
        }
      },
    };
  },
} as unknown as IDBDatabase;

function directoryHandle(
  name: string,
  query: PermissionState = 'granted',
  request: PermissionState = 'granted',
): FileSystemDirectoryHandle {
  return {
    name,
    queryPermission: vi.fn(async () => query),
    requestPermission: vi.fn(async () => request),
  } as unknown as FileSystemDirectoryHandle;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

async function paint(): Promise<void> {
  const callbacks = state.frames.splice(0);
  state.paintedFrames += 1;
  callbacks.forEach((callback) => callback(performance.now()));
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T10:00:00Z'));
  vi.resetModules();
  state.persisted = false;
  state.startSawPersisted = false;
  state.pickerHandle = null;
  state.runs = 0;
  state.meta.clear();
  state.indexCalls = [];
  state.failingRoots.clear();
  state.confirmResult = true;
  state.confirmMessages = [];
  state.frames = [];
  state.paintedFrames = 0;
  state.clicks = [];
  state.reloads = 0;
  state.writer.elected = true;
  state.promotions = [];
  state.uiLoaded = false;
  state.storeReady = false;
  state.uiSawStore = false;
  state.starts = 0;
  state.recoveries = 0;
  state.startSawRecovery = false;
  state.indexGate = null;
  state.inaccessibleHandles.clear();
  state.promoteDuringCounts = false;

  elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  body = new FakeElement('body');
  body.classList = new ClassList('picking');
  vi.stubGlobal('document', {
    body,
    getElementById: (id: string) => elements.get(id) ?? null,
  });
  vi.stubGlobal('location', { reload() { state.reloads += 1; } });
  vi.stubGlobal('confirm', (message: string) => {
    state.confirmMessages.push(message);
    return state.confirmResult;
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    state.frames.push(callback);
    return state.frames.length;
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('indexing lifecycle', () => {
  it('loads dashboard dependencies after the Store and before the first folder selection', async () => {
    const { main } = await import('../src/boot');
    await main();
    expect(state.uiLoaded).toBe(true);
    expect(state.uiSawStore).toBe(true);
    expect(state.starts).toBe(0);
  });

  it('recovers classification before displaying cached history', async () => {
    state.runs = 2;
    state.meta.set('pending_scenarios', ['Air Pure Medium']);
    const { main } = await import('../src/boot');
    await main();
    expect(state.startSawRecovery).toBe(true);
    expect(state.meta.get('pending_scenarios')).toEqual([]);
  });

  it('withholds incomplete derived history in a reader until promotion repairs it', async () => {
    state.runs = 2;
    state.writer.elected = false;
    state.meta.set('pending_scenarios', ['Air Pure Medium']);
    const { main } = await import('../src/boot');
    await main();
    expect(state.starts).toBe(0);
    state.writer.elected = true;
    state.promotions.forEach((notify) => notify());
    await settle();
    expect(state.startSawRecovery).toBe(true);
    expect(body.classList.contains('picking')).toBe(false);
  });

  it('recovers a promotion that happens while boot is awaiting cached counts', async () => {
    state.runs = 2;
    state.writer.elected = false;
    state.promoteDuringCounts = true;
    state.meta.set('pending_scenarios', ['Air Pure Medium']);
    const { main } = await import('../src/boot');
    await main();
    expect(state.startSawRecovery).toBe(true);
    expect(body.classList.contains('picking')).toBe(false);
  });

  it('serializes the complete source acceptance and indexing lifecycle', async () => {
    let release!: () => void;
    state.indexGate = new Promise<void>((resolve) => { release = resolve; });
    const { indexFrom } = await import('../src/boot');
    const first = indexFrom(fakeDatabase, source('upload', 'First'));
    await settle();
    const second = indexFrom(fakeDatabase, source('upload', 'Second'));
    await settle();
    expect(state.indexCalls).toHaveLength(1);
    release();
    await Promise.all([first, second]);
    expect(state.confirmMessages).toHaveLength(1);
    expect(state.meta.get('root_name')).toBe('Second');
  });
  it('records an empty re-read and announces that nothing is new', async () => {
    const { indexFrom } = await import('../src/boot');
    await indexFrom(fakeDatabase, source('upload', 'FPSAimTrainer'));

    expect(state.indexCalls).toHaveLength(1);
    expect(element('pickProgress').textContent).toBe('Nothing new.');
    expect(element('status').textContent).toBe('read just now');
  });

  it('makes the persistence write durable before starting the dashboard', async () => {
    const { indexFrom } = await import('../src/boot');
    await indexFrom(fakeDatabase, source('upload', 'FPSAimTrainer'));

    expect(state.startSawPersisted).toBe(true);
  });

  it('records the accepted source root only after indexing succeeds', async () => {
    const { indexFrom } = await import('../src/boot');
    await indexFrom(fakeDatabase, source('picker', 'FPSAimTrainer'));

    expect(state.meta.get('root_name')).toBe('FPSAimTrainer');
  });

  it('cancels a different-folder merge and keeps the previous current source', async () => {
    const oldSource = source('picker', 'FPSAimTrainer');
    const otherSource = source('picker', 'BackupInstall');
    const { indexFrom, main } = await import('../src/boot');
    await indexFrom(fakeDatabase, oldSource);
    state.confirmResult = false;

    await indexFrom(fakeDatabase, otherSource);

    expect(state.indexCalls).toEqual([oldSource]);
    expect(state.meta.get('root_name')).toBe('FPSAimTrainer');
    expect(state.confirmMessages[0]).toContain('“FPSAimTrainer”');
    expect(state.confirmMessages[0]).toContain('“BackupInstall”');

    await main();
    element('repick').click();
    await settle();
    expect(state.indexCalls).toEqual([oldSource, oldSource]);
  });

  it('does not replace the root or current source when indexing fails', async () => {
    const oldSource = source('picker', 'FPSAimTrainer');
    const brokenSource = source('picker', 'BrokenInstall');
    const { indexFrom, main } = await import('../src/boot');
    await indexFrom(fakeDatabase, oldSource);
    state.failingRoots.add('BrokenInstall');

    await expect(indexFrom(fakeDatabase, brokenSource)).rejects.toThrow('index failed');

    expect(state.meta.get('root_name')).toBe('FPSAimTrainer');
    await main();
    element('repick').click();
    await settle();
    expect(state.indexCalls.at(-1)).toBe(oldSource);
  });

  it('accepts and records a confirmed different-folder merge', async () => {
    const { indexFrom } = await import('../src/boot');
    await indexFrom(fakeDatabase, source('upload', 'FPSAimTrainer'));
    await indexFrom(fakeDatabase, source('upload', 'BackupInstall'));

    expect(state.indexCalls.map((picked) => picked.rootName))
      .toEqual(['FPSAimTrainer', 'BackupInstall']);
    expect(state.meta.get('root_name')).toBe('BackupInstall');
  });
});

describe('snapshot age', () => {
  it('renders a recent age quietly', async () => {
    state.runs = 1;
    state.meta.set('read_at', Date.now() - 10 * 60_000);
    const { main } = await import('../src/boot');

    await main();

    expect(element('repickAge').textContent).toBe('10 min ago');
    expect(element('repick').dataset.stale).toBe('0');
  });

  it('marks an age over one hour stale', async () => {
    state.runs = 1;
    state.meta.set('read_at', Date.now() - 60 * 60_000 - 1);
    const { main } = await import('../src/boot');

    await main();

    expect(element('repickAge').textContent).toBe('1 h ago');
    expect(element('repick').dataset.stale).toBe('1');
    expect(element('status').textContent).toBe('read 1 h ago');
  });

  it('refreshes the age and stale state every minute', async () => {
    state.runs = 1;
    state.meta.set('read_at', Date.now() - 59 * 60_000 - 30_000);
    const { main } = await import('../src/boot');
    await main();
    expect(element('repick').dataset.stale).toBe('0');

    await vi.advanceTimersByTimeAsync(60_000);

    expect(element('repickAge').textContent).toBe('1 h ago');
    expect(element('repick').dataset.stale).toBe('1');
    expect(element('status').textContent).toBe('read 1 h ago');
  });
});

describe('re-picking', () => {
  it('coalesces repeated refresh clicks while restoring a saved handle', async () => {
    const handle = directoryHandle('FPSAimTrainer');
    state.meta.set('handle', handle);
    const { main } = await import('../src/boot');
    await main();
    element('repick').click();
    element('repick').click();
    await settle();
    expect(state.indexCalls).toHaveLength(1);
  });
  it('accepts uploads and reveals controls after reader promotion', async () => {
    state.writer.elected = false;
    const { main } = await import('../src/boot');
    await main();
    state.writer.elected = true;
    state.promotions.forEach((notify) => notify());
    await settle();
    expect(element('pickDir').hidden && element('pickUploadLabel').hidden).toBe(false);
    const input = element('pickUpload');
    input.files = [{}] as unknown as FileList;
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(state.indexCalls).toHaveLength(1);
    expect(body.classList.contains('picking')).toBe(false);
  });

  it('returns to existing history when an upload re-pick is cancelled', async () => {
    state.runs = 1;
    const { main } = await import('../src/boot');
    await main();
    element('repick').click();
    await settle(); await paint(); await paint();
    element('pickUpload').dispatchEvent(new Event('cancel'));
    await settle();
    expect(body.classList.contains('picking')).toBe(false);
  });

  it('offers fresh selection after a saved handle becomes inaccessible', async () => {
    state.runs = 1;
    state.meta.set('handle', directoryHandle('MovedInstall'));
    state.inaccessibleHandles.add('MovedInstall');
    const { main } = await import('../src/boot');
    await main();
    element('repick').click();
    await settle();
    expect(body.classList.contains('picking')).toBe(true);
    expect(element('pickDir').hidden && element('pickUploadLabel').hidden).toBe(false);
    expect(state.meta.get('handle')).toBeNull();
  });
  it('does not re-pick while this tab is not elected writer', async () => {
    const handle = directoryHandle('FPSAimTrainer');
    state.runs = 1;
    state.meta.set('handle', handle);
    state.meta.set('read_at', Date.now());
    state.writer.elected = false;
    const { main } = await import('../src/boot');
    await main();

    element('repick').click();
    await settle();

    expect((handle as any).queryPermission).not.toHaveBeenCalled();
    expect(state.indexCalls).toHaveLength(0);
  });

  it('uses the same bound listener after this tab is promoted to writer', async () => {
    const handle = directoryHandle('FPSAimTrainer');
    state.runs = 1;
    state.meta.set('handle', handle);
    state.meta.set('read_at', Date.now());
    state.writer.elected = false;
    const { main } = await import('../src/boot');
    await main();

    element('repick').click();
    await settle();
    state.writer.elected = true;
    element('repick').click();
    await settle();

    expect((handle as any).queryPermission).toHaveBeenCalledTimes(1);
    expect(state.indexCalls.map((picked) => picked.rootName)).toEqual(['FPSAimTrainer']);
  });

  it('reuses the current picker source without opening a dialog', async () => {
    const picked = source('picker', 'FPSAimTrainer');
    const { indexFrom, main } = await import('../src/boot');
    await indexFrom(fakeDatabase, picked);
    await main();

    element('repick').click();
    await settle();

    expect(state.indexCalls).toEqual([picked, picked]);
    expect(state.clicks.filter(({ id }) => id === 'pickUpload')).toHaveLength(0);
  });

  it('restores a saved handle and requests permission when needed', async () => {
    const handle = directoryHandle('FPSAimTrainer', 'prompt', 'granted');
    state.meta.set('handle', handle);
    const { main } = await import('../src/boot');
    await main();

    element('repick').click();
    await settle();

    expect((handle as any).queryPermission).toHaveBeenCalledWith({ mode: 'read' });
    expect((handle as any).requestPermission).toHaveBeenCalledWith({ mode: 'read' });
    expect(state.indexCalls.map((picked) => picked.rootName)).toEqual(['FPSAimTrainer']);
  });

  it('saves a picker handle only after its source is accepted', async () => {
    const handle = directoryHandle('FPSAimTrainer');
    state.pickerHandle = handle;
    const { main } = await import('../src/boot');
    await main();

    element('pickDir').click();
    await settle();

    expect(state.meta.get('handle')).toBe(handle);
  });

  it('reveals the privacy panel and yields a paint before upload fallback', async () => {
    const { indexFrom, main } = await import('../src/boot');
    await indexFrom(fakeDatabase, source('upload', 'FPSAimTrainer'));
    await main();
    expect(body.classList.contains('picking')).toBe(false);

    element('repick').click();
    await settle();

    expect(body.classList.contains('picking')).toBe(true);
    expect(state.clicks.filter(({ id }) => id === 'pickUpload')).toHaveLength(0);

    await paint();
    expect(state.clicks.filter(({ id }) => id === 'pickUpload')).toHaveLength(0);

    await paint();
    expect(state.clicks.filter(({ id }) => id === 'pickUpload')).toEqual([
      { id: 'pickUpload', paintedFrames: 2, picking: true },
    ]);
  });

  it('reveals the upload fallback when the preferred picker returns no handle', async () => {
    const { main } = await import('../src/boot');
    await main();
    expect(element('pickUploadLabel').hidden).toBe(true);

    element('pickDir').click();
    await settle();

    expect(element('pickUploadLabel').hidden).toBe(false);
  });
});
