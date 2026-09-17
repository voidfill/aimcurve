# aimcurve

Your KovaaK's run history, with nothing to install.

Open the dashboard in a browser and point it at your run history. No account or
upload is involved: nothing leaves the machine, and it never writes to the
KovaaK's install.

To run the dashboard from this checkout, install Node.js 22.12 or newer, then:

```sh
cd web
npm ci
npm run dev
```

Open [http://localhost:4321](http://localhost:4321), then choose the KovaaK's
installation folder containing `stats/` and, when present, `performances/`.
“Choose folder (upload)” is a browser file-selection control; it does not send
the files anywhere. Use “Re-read folder” to refresh your snapshot.

For a static build, run `npm run build` from `web/`. Serve the resulting
`web/dist/` on any static host over HTTPS, or run `npm run preview` from `web/`
and open the localhost address it prints. Web Locks, used to keep one tab in
charge of indexing, require HTTPS or localhost; a plain HTTP LAN address does
not enable indexing. Opening `index.html` as a local file is not a supported
entry point. People visiting a hosted build need only their browser; Node and
the build tools are for running or hosting this checkout.

What it shows that the others don't is *where in the run* the difference
happened. Put a run's per-second curve against your PB and recent form, then
see the stretch where you actually lost it instead of one more point on a
score-over-time graph.

## Layout

```
web/                     the app: Astro, TypeScript, no server
  src/core/              parsers, comparison, payload building — pure, no storage
  src/db/                the IndexedDB index
  src/source/            where runs are read from
  src/ui/                the dashboard
  public/                served as-is, including vendor/ (uPlot)
  test/                  the TypeScript tests, and test/oracle/ the diff
aimcurve/                the frozen Python, kept as the oracle
tests/                   the Python's tests and the shared fixtures
references/kovaaks.md    on-disk format notes, verified against a real install
docs/                    design specs and implementation plans
```

## Python reference

Python is not the dashboard or a server. It is the frozen reference
implementation used to check the browser port, reachable only as
`python -m aimcurve dump`.

## Tests

The browser engine, offline and with no Python involved:

```
cd web && npm test
```

And the differential check, which runs both over the fixtures and compares
every field of every payload — not just the default view, but each of the six
metrics, five smoothing windows, four recent-N values, `same_cfg=0`, and the
rail under every limit, scenario filter and cursor:

```
cd web && npm run oracle

# where there is no bare python3 -- this repository's own dev environment:
nix shell nixpkgs#python3 --command bash -c 'cd web && npm run oracle'
```

Numbers compare exactly, with no tolerance: the two implementations agree to
the last bit today, and the only bugs this port has actually shipped were
one-ulp ones that any tolerance would have hidden. It never skips either. If it
cannot reach Python it fails, because a differential test that passes when it
could only run one side reports green over nothing. Set `AIMCURVE_PYTHON` if
`python3` is not what launches it.

The frozen Python reference suite remains available for its parser and payload
fixtures:

```
nix shell nixpkgs#python3 --command python3 -m unittest discover -s tests
```

What none of these cover is the browser itself: IndexedDB, the directory
picker, CSS, layout, and event dispatch. Those still want eyes on the page.

## Scope

Read-only over the game's run history. Playlist management lives in a separate tool,
[claude-kovaaks](https://github.com/voidfill/claude-kovaaks), which aimcurve was split
out of. Game settings and benchmark rank tracking are out of scope for both.
