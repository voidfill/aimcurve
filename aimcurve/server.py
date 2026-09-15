"""HTTP surface: static shell, JSON API, SSE push.

ThreadingHTTPServer is required, not optional: /events holds a connection open
for the life of the page, and a single-threaded server would then serve nothing
else.
"""

import json
import mimetypes
import os
import queue
import socket
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import index, payload, watch

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

# SQLite stores INTEGER as a signed 64-bit value. Plain int() has no such
# ceiling -- it happily parses an arbitrarily large digit string -- so a huge
# query-string value sails past the existing `except ValueError` guard and
# only fails deep inside conn.execute, as an unhandled OverflowError that
# kills the connection with no HTTP response at all.
SQLITE_INT_MAX = 2 ** 63 - 1

# /api/runs?limit=... has no natural ceiling from the UI (index.html never
# asks for more than a few hundred rows), but two things make an unvalidated
# value dangerous: a huge one overflows SQLite as above, and a *negative* one
# is silently treated by SQLite as "no limit", returning the entire table
# (2331 rows in the reference corpus). Cap well above any real UI request --
# comfortably past "give me the whole table" -- so a legitimate large request
# still works while both failure modes are rejected up front.
MAX_LIMIT = 100_000


def _bounded_int(raw, minimum, maximum):
    """int(raw), rejecting values outside [minimum, maximum].

    Raises ValueError for both non-numeric input (same as plain int()) and
    in-range-for-Python-but-out-of-range-for-us input, so callers keep a
    single except ValueError branch instead of needing a second error path
    for the overflow case.
    """
    value = int(raw)
    if value < minimum or value > maximum:
        raise ValueError(f"{raw!r} out of range [{minimum}, {maximum}]")
    return value


def make_handler(cfg, conn, subscribers, lock, watcher=None):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass  # the terminal belongs to the operator, not to access logs

        def _json(self, payload, status=200):
            body = json.dumps(payload, default=float).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _static(self, relative):
            full = os.path.normpath(os.path.join(WEB, relative.lstrip("/")))
            # Trailing separator matters: a bare prefix test also admits a
            # sibling directory whose name merely starts with "web".
            if not full.startswith(WEB + os.sep) or not os.path.isfile(full):
                return self._json({"error": "not found"}, 404)
            kind = mimetypes.guess_type(full)[0] or "application/octet-stream"
            with open(full, "rb") as handle:
                body = handle.read()
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _events(self):
            channel = queue.Queue()
            with lock:
                subscribers.append(channel)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                while True:
                    try:
                        message = channel.get(timeout=15)
                        chunk = f"data: {json.dumps(message)}\n\n"
                    except queue.Empty:
                        chunk = ": keepalive\n\n"
                    self.wfile.write(chunk.encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                with lock:
                    if channel in subscribers:
                        subscribers.remove(channel)

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            route = parsed.path
            query = urllib.parse.parse_qs(parsed.query)

            def one(name, default=None):
                return query.get(name, [default])[0]

            if route == "/":
                return self._static("index.html")
            if route.startswith("/web/"):
                return self._static(route[len("/web/"):])
            if route == "/events":
                return self._events()

            if route == "/api/health":
                one_row = lambda sql: conn.execute(sql).fetchone()[0]
                return self._json({
                    "runs": one_row("SELECT COUNT(*) FROM run"),
                    "curves": one_row("SELECT COUNT(*) FROM curve"),
                    "failed": one_row("SELECT COUNT(*) FROM failed"),
                    "scenarios": one_row("SELECT COUNT(DISTINCT scenario) FROM run"),
                    "awaiting_perf": len(watcher.stats["awaiting_perf"]) if watcher else 0,
                    "watcher_errors": watcher.stats["errors"] if watcher else 0,
                })

            if route == "/api/runs":
                scenario = one("scenario")
                before = one("before")
                try:
                    limit = _bounded_int(one("limit", "50"), 0, MAX_LIMIT)
                    # A cursor reaches the same query `limit` does, so it gets
                    # the same bounds check rather than a 500 from deep inside
                    # conn.execute. An id that is merely absent is a valid
                    # question with an empty answer, and is not checked here.
                    if before is not None:
                        before = _bounded_int(before, 1, SQLITE_INT_MAX)
                except ValueError as error:
                    return self._json({"error": str(error)}, 400)
                return self._json(payload.run_list(
                    conn, limit, scenario=scenario or None, before=before,
                    same_cfg=one("same_cfg", "1") != "0"))

            if route == "/api/scenarios":
                return self._json(payload._rows(conn, """
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
                    FROM run s GROUP BY s.scenario ORDER BY last_played DESC"""))

            if route == "/api/session/today":
                day = one("day")
                if not day:
                    day = conn.execute(
                        "SELECT MAX(substr(started_at,1,10)) FROM run").fetchone()[0]
                return self._json({"day": day, "runs": payload._rows(
                    conn,
                    "SELECT id, scenario, started_at, score, accuracy, spm "
                    "FROM run WHERE substr(started_at,1,10)=? ORDER BY started_at",
                    (day,))})

            if route.startswith("/api/run/"):
                try:
                    run_id = _bounded_int(route.rsplit("/", 1)[-1], 1, SQLITE_INT_MAX)
                except ValueError:
                    return self._json({"error": "bad run id"}, 400)
                try:
                    return self._json(payload.build_run_payload(
                        conn, run_id,
                        metric=one("metric", "score"),
                        smoothing=int(one("smoothing", "5")),
                        recent_n=int(one("recent_n", "10")),
                        same_cfg=one("same_cfg", "1") != "0"))
                except KeyError:
                    return self._json({"error": "no such run"}, 404)
                except ValueError as error:
                    return self._json({"error": str(error)}, 400)

            return self._json({"error": "not found"}, 404)

    return Handler


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    # HTTPServer sets allow_reuse_address = 1, which on Windows lets a second
    # process bind a port that is already in use instead of raising -- two
    # instances would then silently share the port and the caller's
    # try-the-next-port loop would never fire.
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_server(cfg, conn, port=8777, subscribers=None, lock=None, watcher=None):
    subscribers = [] if subscribers is None else subscribers
    lock = threading.Lock() if lock is None else lock
    handler = make_handler(cfg, conn, subscribers, lock, watcher)
    return _Server(("127.0.0.1", port), handler)


def serve(cfg, port=8777):
    """Bootstrap, start the watcher, then serve until interrupted."""
    conn = index.connect(cfg.db_path)
    conn.execute("PRAGMA journal_mode=WAL")

    print("indexing...", flush=True)
    counts = index.bootstrap(conn, cfg)
    print(f"  {counts['runs']} new runs, {counts['curves']} curves, "
          f"{counts['reconciled']} reconciled, {counts['failed']} failed", flush=True)

    subscribers, lock = [], threading.Lock()

    # The watcher owns its own connection: sqlite3 objects are not shareable
    # across threads by default, and the HTTP handlers use the main one.
    watch_conn = index.connect(cfg.db_path)

    def announce(run_id):
        with lock:
            targets = list(subscribers)
        for channel in targets:
            channel.put({"type": "run", "id": run_id})

    watcher = watch.Watcher(cfg, watch_conn, on_run=announce)
    stop = threading.Event()
    threading.Thread(target=watcher.run_forever, args=(stop,), daemon=True).start()

    for candidate in range(port, port + 20):
        try:
            httpd = make_server(cfg, conn, candidate, subscribers, lock, watcher)
            break
        except OSError:
            continue
    else:
        raise SystemExit(f"no free port in {port}..{port + 19}")

    print(f"aimcurve -> http://127.0.0.1:{httpd.server_address[1]}/", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        httpd.server_close()
