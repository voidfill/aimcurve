/* The seam. app.js asked a server these five questions; now it asks the page.
   Same paths, same query strings, same payload shapes — which is what lets
   app.js move over near-verbatim and what lets the oracle diff keep meaning
   something about what the browser actually renders. */

import { getHealth, getRun, getRuns, getScenarios, getSession } from '../core/api';

/** Set once at boot, before app.js runs. */
let store = null;
export function useStore(next) { store = next; }

const flag = (params, name, fallback) =>
  (params.get(name) ?? fallback) !== '0';

export async function api(path) {
  if (!store) throw new Error('no store');
  const [route, query] = path.split('?');
  const p = new URLSearchParams(query || '');

  if (route === '/api/health') return getHealth(store);

  if (route === '/api/runs') {
    return getRuns(store, {
      limit: Number(p.get('limit') ?? 50),
      scenario: p.get('scenario') || null,
      before: p.get('before') || null,
      sameCfg: flag(p, 'same_cfg', '1'),
    });
  }

  if (route === '/api/scenarios') return getScenarios(store);

  if (route === '/api/session/today') {
    return getSession(store, p.get('day') || undefined);
  }

  if (route.startsWith('/api/run/')) {
    const id = decodeURIComponent(route.slice('/api/run/'.length));
    return getRun(store, id, {
      metric: p.get('metric') ?? 'score',
      smoothing: Number(p.get('smoothing') ?? 5),
      recentN: Number(p.get('recent_n') ?? 10),
      sameCfg: flag(p, 'same_cfg', '1'),
    });
  }

  throw new Error(`no such route: ${route}`);
}
