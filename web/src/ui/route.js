/* Hash routing is kept free of DOM work so a pasted URL can be validated
   before the dashboard acts on it. */
const VIEWS = ['run', 'session', 'scenarios'];

function decodeRunId(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    // A pasted, truncated percent escape is not a route. Treat it like an
    // absent run so applyRoute can select and normalise to the newest one.
    return null;
  }
}

export function parseHash(hash) {
  const [path, qs] = hash.replace(/^#\/?/, '').split('?');
  const seg = path.split('/').filter(Boolean);
  const view = VIEWS.includes(seg[0]) ? seg[0] : 'run';
  return {
    view,
    runId: view === 'run' && seg[1] ? decodeRunId(seg[1]) : null,
    scenario: new URLSearchParams(qs || '').get('scenario') || null,
  };
}

export function formatHash({ view, runId, scenario }) {
  if (view !== 'run') return '#/' + view;
  return '#/run' + (runId == null ? '' : '/' + encodeURIComponent(runId)) +
         (scenario ? '?scenario=' + encodeURIComponent(scenario) : '');
}
