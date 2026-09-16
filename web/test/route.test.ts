import { describe, expect, it } from 'vitest';
import { parseHash } from '../src/ui/route.js';

describe('hash routing', () => {
  it('treats a malformed encoded run id as no selection', () => {
    expect(parseHash('#/run/pasted%2')).toEqual({
      view: 'run', runId: null, scenario: null,
    });
  });
});
