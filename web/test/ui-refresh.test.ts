import { afterEach, expect, it, vi } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import { useStore } from '../src/ui/api-shim.js';
import { readStats } from './fixtures';

// DOM/plot surfaces are external to this Node test. Payloads, routing and
// rendering run through the real dashboard, API shim, and Store.
class Element extends EventTarget {
  textContent = ''; innerHTML = ''; hidden = false; value: unknown = '';
  dataset: Record<string, string> = {};
  classList = { add() {}, remove() {}, contains() { return false; } };
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  setAttribute() {}
  scrollIntoView() {}
}

afterEach(() => { vi.unstubAllGlobals(); });

it('reloads focused comparisons and classification while retaining the selected run', async () => {
  const a = 'Air Spectral Easy - Challenge - 2026.09.05-08.20.43';
  const b = 'Air Spectral Easy - Challenge - 2026.09.11-18.37.39';
  const nodes = new Map<string, Element>();
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector)!;
  };
  vi.stubGlobal('document', {
    querySelector: node, querySelectorAll: () => [], documentElement: new Element(),
    addEventListener() {},
  });
  vi.stubGlobal('window', { CSS: null });
  const location = { hash: `#/run/${encodeURIComponent(a)}` };
  vi.stubGlobal('location', location);
  vi.stubGlobal('history', { replaceState(_a: unknown, _b: unknown, hash: string) { location.hash = hash; } });
  vi.stubGlobal('addEventListener', () => {});
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#000000' }));
  vi.stubGlobal('matchMedia', () => ({ addEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('uPlot', { sync: () => ({}) });

  useStore(buildStore([ingest(a, readStats(a))]));
  const { start } = await import('../src/ui/app.js');
  await start();
  expect(node('#status').dataset.state).not.toBe('down');
  expect(node('#hlStats').innerHTML).toContain('spm');
  const selected = location.hash;

  useStore(buildStore([ingest(a, readStats(a)), ingest(b, readStats(b))]));
  await start();
  expect(node('#status').dataset.state).not.toBe('down');
  expect(location.hash).toBe(selected);
  expect(node('#hlScore').textContent).toBe('914.9');
  expect(node('#hlStats').innerHTML).toContain('elapsed');
  expect(node('#splitPanel').hidden).toBe(false);
});
