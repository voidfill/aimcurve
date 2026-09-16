import { beforeAll, describe, expect, it } from 'vitest';
import { ingest } from '../src/core/ingest';
import { buildStore } from '../src/core/memstore';
import type { Payload } from '../src/core/payload';
import { api, useStore } from '../src/ui/api-shim.js';
import { readPerf, readStats, statsIds } from './fixtures';

const GROUND_B = 'VT Ground Intermediate S5 - Challenge - 2026.06.16-20.49.09';

beforeAll(() => {
  useStore(buildStore(statsIds().map((id) => ingest(id, readStats(id), readPerf(id)))));
});

describe('browser API query defaults', () => {
  it('uses the default rail limit when limit is blank', async () => {
    expect(await api('/api/runs?limit=')).toHaveLength(11);
  });

  it('uses the default run options when their values are blank', async () => {
    const payload = await api(
      `/api/run/${encodeURIComponent(GROUND_B)}?metric=&smoothing=&recent_n=`,
    ) as Payload;

    expect(payload.rate.metric).toBe('score');
    expect(payload.rate.mine.slice(0, 4))
      .toEqual([52.666666666666664, 49.5, 44.6, 40.2]);
    expect(payload.rate.band).not.toBeNull();
  });
});
