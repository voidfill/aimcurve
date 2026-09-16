import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  readAt: null as number | null,
  persisted: false,
  startSawPersisted: false,
  pickerHandle: null as FileSystemDirectoryHandle | null,
}));

vi.mock('../src/db/idbstore', () => ({
  createStore: () => ({
    counts: async () => ({ runs: 0, curves: 0, failed: 0, scenarios: 0 }),
  }),
}));

vi.mock('../src/db/indexer', () => ({
  pendingIds: async () => [],
  indexInto: async () => { state.readAt = Date.now(); },
}));

vi.mock('../src/db/schema', () => ({
  META_READ_AT: 'read_at',
  META_PERSISTED: 'persisted',
  openDatabase: async () => fakeDatabase,
  req: async () => state.readAt === null ? undefined : { value: state.readAt },
  requestPersistence: async () => true,
  done: async (transaction: { commit(): Promise<void> }) => transaction.commit(),
}));

vi.mock('../src/db/writer', () => ({
  electWriter: async () => ({ elected: true, release() {} }),
}));

vi.mock('../src/source/picker', () => ({
  supportsPicker: () => true,
  pickDirectory: async () => state.pickerHandle,
  pickerSource: async () => { throw new Error('not reached without a handle'); },
}));

vi.mock('../src/source/upload', () => ({
  uploadSource: () => { throw new Error('not reached without files'); },
}));

vi.mock('../src/ui/api-shim.js', () => ({
  useStore: () => {},
}));

vi.mock('../src/ui/app.js', () => {
  return {
    start: async () => { state.startSawPersisted = state.persisted; },
    setSnapshotAge: (label: string) => {
      element('status').textContent = label;
    },
  };
});

class ClassList {
  private names = new Set<string>();

  constructor(...names: string[]) { names.forEach((name) => this.names.add(name)); }
  add(name: string) { this.names.add(name); }
  remove(name: string) { this.names.delete(name); }
  contains(name: string) { return this.names.has(name); }
}

class FakeElement extends EventTarget {
  hidden = false;
  textContent: string | null = null;
  value = '';
  files: FileList | null = null;
  classList = new ClassList();
}

const ids = [
  'pickProgress', 'pickError', 'repick', 'pickDir', 'pickUploadLabel',
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
    let persisted: boolean | null = null;
    return {
      objectStore() {
        return {
          get() { return {}; },
          put(row: { key: string; value: boolean }) {
            if (row.key === 'persisted') persisted = row.value;
          },
        };
      },
      async commit() {
        await Promise.resolve();
        if (persisted !== null) state.persisted = persisted;
      },
    };
  },
} as unknown as IDBDatabase;

beforeEach(() => {
  vi.resetModules();
  state.readAt = null;
  state.persisted = false;
  state.startSawPersisted = false;
  state.pickerHandle = null;

  elements = new Map(ids.map((id) => [id, new FakeElement()]));
  body = new FakeElement();
  body.classList = new ClassList('picking');
  vi.stubGlobal('document', {
    body,
    getElementById: (id: string) => elements.get(id) ?? null,
  });
  vi.stubGlobal('location', { reload() {} });
});

describe('first-run boot', () => {
  it('records an empty re-read and announces that nothing is new', async () => {
    const { indexFrom } = await import('../src/boot');
    await indexFrom(fakeDatabase, {
      kind: 'upload', pickedAt: 0, list: async () => [], read: async () => ({}),
    });

    expect(element('pickProgress').textContent).toBe('Nothing new.');
    expect(element('status').textContent).toBe('read just now');
  });

  it('makes the persistence write durable before starting the dashboard', async () => {
    const { indexFrom } = await import('../src/boot');
    await indexFrom(fakeDatabase, {
      kind: 'upload', pickedAt: 0, list: async () => [], read: async () => ({}),
    });

    expect(state.startSawPersisted).toBe(true);
  });

  it('reveals the upload fallback when the preferred picker returns no handle', async () => {
    const { main } = await import('../src/boot');
    await main();
    expect(element('pickUploadLabel').hidden).toBe(true);

    element('pickDir').dispatchEvent(new Event('click'));
    await Promise.resolve();
    await Promise.resolve();

    expect(element('pickUploadLabel').hidden).toBe(false);
  });
});
