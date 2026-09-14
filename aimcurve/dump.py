"""Emitting every API payload for a folder of runs, as one JSON document.

This exists so the browser port can be diffed against this implementation
without either side running a server. It is the whole API surface in one file:
every run's payload, the rail, the scenario list and each day's session view.

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

    return {
        "runs": runs,
        "rail": payload.run_list(conn, ALL),
        "scenarios": scenarios,
        "days": days,
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
