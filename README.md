# aimcurve

Your KovaaK's run history, with nothing to install.

Every other stats tracker asks you to clone a repository and install packages before it
will show you anything. This one doesn't: no pip, no dependencies, no build step, no
account. Nothing you do here leaves the machine, and it never writes to the KovaaK's
install.

What it shows that the others don't is *where in the run* the difference happened. About
a second after a run ends, it puts that run's per-second curve against your PB and your
recent form — so instead of one more point on a score-over-time graph, you see the
stretch where you actually lost it.

```
python -m aimcurve
```

Then open the printed URL. Python 3 and the standard library, which you already have.

> **Where this is going:** the dashboard is being rewritten to run entirely in the
> browser — open a link, point it at your game folder, and it reads your history locally
> with no terminal and no Python at all. The design for that is in
> [docs/superpowers/specs](docs/superpowers/specs). Until it lands, the Python here is
> the product; afterwards it stays on as the reference implementation the browser version
> is checked against.

The first launch indexes your whole history into a SQLite cache outside the game directory
(about 5 s for ~2330 runs, producing a database of about 6.3 MB). After that it only reads
new files. The cache is disposable — delete it and it rebuilds.

Three things worth knowing about the data:

- KovaaK's writes a `.perf` time-series alongside most runs, but not all — runs
  without one still appear, just without a curve.
- Runs are only compared against runs at the same true sensitivity (cm/360), since
  comparing across a sens change is not a fair comparison. Toggle it off in the UI if
  you want to compare anyway.
- Not every scenario is scored on a clock. Some spawn a fixed number of bots and
  score you on how long you took (`score = 1000 - elapsed`). Those are charted
  against share of the damage pool rather than seconds, so bot boundaries line up
  between runs, and the delta chart reads in seconds gained or lost.

## Layout

```
aimcurve/                parser, index, watcher, server, web assets
tests/                   unit tests for every module
scripts/drive-client.mjs drives aimcurve's own app.js against a running server
references/kovaaks.md    on-disk format and API notes, verified against a real install
docs/                    design specs and implementation plans
```

## Tests

The Python:

```
python -m unittest discover -s tests
```

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
```

Numbers compare exactly, with no tolerance: the two implementations agree to
the last bit today, and the only bugs this port has actually shipped were
one-ulp ones that any tolerance would have hidden. It never skips either. If it
cannot reach Python it fails, because a differential test that passes when it
could only run one side reports green over nothing. Set `AIMCURVE_PYTHON` if
`python3` is not what launches it.

The Python dashboard's own client has one more rig, kept out of the suite on
purpose — it needs node and a live server, and a test that silently skips when
it cannot find either reports green while covering nothing. Run it by hand
after touching the rail, the paging, or the run-time formatting:

```
python -m aimcurve                 # one terminal
node scripts/drive-client.mjs     # another
```

It loads `aimcurve/web/app.js` — the same file the browser gets, unmodified on
disk — under a stub DOM, so it exercises the real client rather than a copy of
it. Exit 0 passed, 1 failed, 2 could not reach the server; `--port=` or
`--base=` if it is not on 8777.

What none of these cover is the browser itself: IndexedDB, the directory
picker, CSS, layout, event dispatch. Those still want eyes on the page.

## Scope

Read-only over the game's run history. Playlist management lives in a separate tool,
[claude-kovaaks](https://github.com/voidfill/claude-kovaaks), which aimcurve was split
out of. Game settings and benchmark rank tracking are out of scope for both.
