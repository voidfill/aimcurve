"""python -m aimcurve [--port N] | python -m aimcurve dump --root DIR --out FILE"""

import argparse
import sys

from . import dump, paths, server


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "dump":
        return dump.main(argv[1:])

    # `dump` is dispatched above, before argparse ever sees an argument, because
    # it carries its own parser -- so argparse cannot discover it and --help has
    # to be told it exists.
    parser = argparse.ArgumentParser(
        prog="aimcurve",
        epilog="subcommands:\n"
               "  dump --root DIR --out FILE\n"
               "      emit every API payload for a folder of runs as one JSON\n"
               "      document; the oracle the browser port is diffed against\n",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8777)
    args = parser.parse_args(argv)
    try:
        cfg = paths.load()
    except paths.Fail as error:
        print(error, file=sys.stderr)
        return error.code
    server.serve(cfg, args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
