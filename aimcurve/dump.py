"""Emitting every API payload for a folder of runs, as one JSON document.

This exists so the browser port can be diffed against this implementation
without either side running a server. It is the whole API surface in one file:
every run's payload, the rail, the scenario list and each day's session view.

Plus an option matrix. The default view exercises one metric of six, one
smoothing window, one recent-N and the rail with no cursor -- so a dump of only
the defaults never compares the ratio branch of `_series`, the zero-denominator
rule in `_ratio`, the recent-N slice boundary, `same_cfg=0`, the cursor, or the
health counts. `cases`, `rails`, `health` and `session` cover the rest.

`ids` maps this database's row counters onto run basenames. The browser keys on
the basename -- a row counter does not survive a machine, let alone a re-pick --
so the harness needs the correspondence spelled out rather than inferred.
"""

import argparse
import json
import os
import sys
import tempfile

from . import index, paths, payload

# Matches server.py's /api/runs default ceiling closely enough for a dump: the
# point is "all of them", and a real install is far below this.
ALL = 100_000


def _basename_id(stats_file):
    base = os.path.basename(stats_file)
    return base[: -len(" Stats.csv")] if base.endswith(" Stats.csv") else base


def run_cases():
    """[(case key, build_run_payload kwargs)] -- the per-run option matrix.

    The key is a literal string, and the port builds the same literals rather
    than deriving them: the two documents are joined on this key, and a key
    formatted from a number on one side and a template literal on the other is
    one repr away from lining nothing up while still reporting no differences.

    recent_n runs below 1 on purpose. `prior[-recent_n:]` reads 0 as "every
    prior run" and a negative value as "drop from the front", which is a slice
    quirk rather than an intention -- both sides clamp, and this is what
    checks that they clamp identically.
    """
    cases = [(f"metric={name}", {"metric": name}) for name in payload.METRICS]
    cases += [(f"smoothing={n}", {"smoothing": n}) for n in (0, 1, 2, 3, 7)]
    cases += [(f"recent_n={n}", {"recent_n": n}) for n in (-5, 0, 1, 3)]
    cases += [("same_cfg=0", {"same_cfg": False})]
    return cases


def build(conn):
    """-> the whole API surface for this database."""
    runs = {}
    ids = {}
    for row in conn.execute("SELECT id, stats_file FROM run ORDER BY id"):
        runs[str(row["id"])] = payload.build_run_payload(conn, row["id"])
        ids[str(row["id"])] = _basename_id(row["stats_file"])

    scenarios = payload._rows(conn, """
        SELECT s.scenario, COUNT(*) AS runs, MAX(s.score) AS pb,
               MAX(s.started_at) AS last_played,
               (SELECT shape FROM scenario WHERE name = s.scenario) AS shape,
               (SELECT elapsed_s FROM run r WHERE r.scenario = s.scenario
                 ORDER BY r.score DESC LIMIT 1) AS pb_elapsed,
               (SELECT AVG(elapsed_s) FROM (
                    SELECT elapsed_s FROM run r WHERE r.scenario = s.scenario
                    ORDER BY started_at DESC LIMIT 10)) AS recent_elapsed,
               (SELECT AVG(score) FROM (
                    SELECT score FROM run r WHERE r.scenario = s.scenario
                    ORDER BY started_at DESC LIMIT 10)) AS recent_form
        FROM run s GROUP BY s.scenario ORDER BY last_played DESC""")

    days = {}
    for (day,) in conn.execute(
            "SELECT DISTINCT substr(started_at,1,10) FROM run ORDER BY 1"):
        days[day] = payload._rows(
            conn,
            "SELECT id, scenario, started_at, score, accuracy, spm "
            "FROM run WHERE substr(started_at,1,10)=? ORDER BY started_at",
            (day,))

    # Every run under every option in the matrix. Keyed "<basename>|<case>"
    # because the browser has no row counters to key on.
    cases = {}
    for row_id, base in ids.items():
        for key, kwargs in run_cases():
            cases[f"{base}|{key}"] = payload.build_run_payload(
                conn, int(row_id), **kwargs)

    # The rail under the parameters the URL can carry. `before` is a row
    # counter here and a basename in the browser, so the key is the basename
    # on both sides -- the same inversion `ids` exists for.
    rails = {}
    for limit in (0, 1, 5):
        rails[f"limit={limit}"] = payload.run_list(conn, limit)
    rails["same_cfg=0"] = payload.run_list(conn, ALL, same_cfg=False)
    for row in scenarios:
        rails[f"scenario={row['scenario']}"] = payload.run_list(
            conn, ALL, scenario=row["scenario"])
    for row_id, base in ids.items():
        rails[f"before={base}"] = payload.run_list(conn, ALL, before=int(row_id))

    # What /api/health answers, less awaiting_perf and watcher_errors: both
    # read a live watcher's counters, which a dump has no business inventing.
    def count(sql):
        return conn.execute(sql).fetchone()[0]

    health = {
        "runs": count("SELECT COUNT(*) FROM run"),
        "curves": count("SELECT COUNT(*) FROM curve"),
        "failed": count("SELECT COUNT(*) FROM failed"),
        "scenarios": count("SELECT COUNT(DISTINCT scenario) FROM run"),
    }

    # /api/session/today with no `day`: the most recent day that has runs,
    # which is a choice the server makes and so is worth diffing.
    (today,) = conn.execute("SELECT MAX(substr(started_at,1,10)) FROM run").fetchone()
    session = {"day": today, "runs": payload._rows(
        conn,
        "SELECT id, scenario, started_at, score, accuracy, spm "
        "FROM run WHERE substr(started_at,1,10)=? ORDER BY started_at",
        (today,))}

    return {
        "runs": runs,
        "cases": cases,
        "rail": payload.run_list(conn, ALL),
        "rails": rails,
        "scenarios": scenarios,
        "days": days,
        "health": health,
        "session": session,
        "ids": ids,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(prog="aimcurve dump")
    parser.add_argument("--root", required=True,
                        help="a folder containing stats/ and performances/")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    # A throwaway database every time. A dump that reused a cache could report
    # a schema from a previous version of the code, which is precisely the
    # failure an oracle must not have.
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = paths.load({"KOVAAKS_DIR": args.root,
                              "AIMCURVE_DB": os.path.join(tmp, "dump.sqlite3")})
            conn = index.connect(cfg.db_path)
            counts = index.bootstrap(conn, cfg)
            document = build(conn)

        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(document, handle, default=float, sort_keys=True, indent=1)
    # The diff harness shells out to this command. A traceback there says
    # "the port is broken" when the truth is "--root was wrong", which is the
    # most expensive kind of wrong answer a verification step can give.
    except paths.Fail as error:
        print(error, file=sys.stderr)
        return error.code
    except OSError as error:
        print(error, file=sys.stderr)
        return paths.EXIT_INPUT
    print(f"{counts['runs']} runs, {counts['curves']} curves -> {args.out}",
          file=sys.stderr)
    return 0
