"""python -m aimcurve dump --root DIR --out FILE

The dashboard is a web page now; see web/. What is left here is the reference
implementation the browser port is checked against.
"""

import sys

from . import dump


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv or argv[0] != "dump":
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        return 2
    return dump.main(argv[1:])


if __name__ == "__main__":
    sys.exit(main())
