import { afterEach, expect, it, vi } from 'vitest';
import { electWriter } from '../src/db/writer';

afterEach(() => vi.unstubAllGlobals());

it('notifies a reader when the queued Web Lock promotes it', async () => {
  let promote!: () => Promise<void>;
  vi.stubGlobal('navigator', { locks: {
    request(_name: string, options: unknown, callback?: (lock: unknown) => unknown) {
      if (callback) return Promise.resolve(callback(null));
      promote = options as () => Promise<void>;
      return Promise.resolve();
    },
  } });
  const writer = await electWriter();
  expect(writer.elected).toBe(false);
  const observed: boolean[] = [];
  expect(writer.subscribe).toBeTypeOf('function');
  writer.subscribe(() => observed.push(writer.elected));
  const held = promote();
  expect(observed).toEqual([true]);
  writer.release();
  await held;
});
