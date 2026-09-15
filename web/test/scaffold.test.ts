import { describe, expect, it } from 'vitest';
import { readPerf, readStats, statsIds } from './fixtures';

describe('fixtures', () => {
  it('finds all eleven stats files', () => {
    expect(statsIds()).toHaveLength(11);
  });

  it('reads a stats file as text', () => {
    const text = readStats('Air Pure Medium - Challenge - 2026.09.12-16.04.49');
    expect(text).toContain('Scenario:,Air Pure Medium');
  });

  it('reads a perf file as bytes', () => {
    const bytes = readPerf('Air Pure Medium - Challenge - 2026.09.12-16.04.49');
    expect(bytes!.byteLength).toBeGreaterThan(1000);
  });

  it('reports a missing perf as undefined rather than throwing', () => {
    expect(readPerf('Air Spectral Easy - Challenge - 2026.09.11-18.37.39')).toBeUndefined();
  });
});
