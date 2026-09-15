import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from aimcurve import dump, index, paths  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


class DumpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cfg = paths.load({"KOVAAKS_DIR": FIXTURES,
                          "AIMCURVE_DB": os.path.join(cls.tmp.name, "i.sqlite3")})
        conn = index.connect(cfg.db_path)
        index.bootstrap(conn, cfg)
        cls.doc = dump.build(conn)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_every_run_has_a_payload(self):
        self.assertEqual(len(self.doc["runs"]), 11)

    def test_ids_map_to_basenames(self):
        self.assertEqual(
            self.doc["ids"]["3"],
            "Air Pure Medium - Challenge - 2026.09.12-16.04.49")

    def test_race_payload_carries_its_shape(self):
        payload = self.doc["runs"]["3"]
        self.assertEqual(payload["scenario"]["shape"], "race")
        self.assertEqual(payload["axis"]["n"], 200)
        self.assertAlmostEqual(payload["delta"]["final"], 7.855, places=3)

    def test_rail_is_newest_first_and_complete(self):
        self.assertEqual(len(self.doc["rail"]), 11)
        self.assertEqual(self.doc["rail"][0]["id"], 3)

    def test_days_are_keyed_by_date(self):
        self.assertIn("2026-09-12", self.doc["days"])
        self.assertEqual(len(self.doc["days"]["2026-09-12"]), 1)

    def test_cases_cover_every_run_under_every_option(self):
        self.assertEqual(len(dump.run_cases()), 16)
        self.assertEqual(len(self.doc["cases"]), 11 * 16)
        for base in self.doc["ids"].values():
            for key, _ in dump.run_cases():
                self.assertIn(f"{base}|{key}", self.doc["cases"])

    def test_cases_actually_vary_the_payload(self):
        base = self.doc["ids"]["3"]
        # A race fixes the y series, so its metric buttons do not move the
        # chart -- take a timed run with a curve for the metric check.
        timed = self.doc["ids"]["6"]
        self.assertNotEqual(self.doc["cases"][f"{timed}|metric=accuracy"]["rate"]["mine"],
                            self.doc["cases"][f"{timed}|metric=score"]["rate"]["mine"])
        self.assertNotEqual(self.doc["cases"][f"{base}|smoothing=0"]["rate"]["mine"],
                            self.doc["cases"][f"{base}|smoothing=7"]["rate"]["mine"])
        # recent_n<=0 is the slice quirk: "all prior runs", not "none".
        self.assertEqual(self.doc["cases"][f"{base}|recent_n=-5"]["baselines"]["recent_n"],
                         self.doc["cases"][f"{base}|recent_n=0"]["baselines"]["recent_n"])

    def test_rails_cover_limits_cursors_and_scenarios(self):
        self.assertEqual(self.doc["rails"]["limit=0"], [])
        self.assertEqual(len(self.doc["rails"]["limit=1"]), 1)
        self.assertEqual(len(self.doc["rails"]["limit=5"]), 5)
        self.assertEqual(len(self.doc["rails"]["same_cfg=0"]), 11)
        for base in self.doc["ids"].values():
            self.assertIn(f"before={base}", self.doc["rails"])
        for row in self.doc["scenarios"]:
            self.assertIn(f"scenario={row['scenario']}", self.doc["rails"])
        # The newest run's cursor pages to everything older than it.
        newest = self.doc["ids"][str(self.doc["rail"][0]["id"])]
        self.assertEqual(len(self.doc["rails"][f"before={newest}"]), 10)

    def test_health_is_the_four_countable_fields(self):
        self.assertEqual(self.doc["health"],
                         {"runs": 11, "curves": 7, "failed": 0, "scenarios": 8})

    def test_session_defaults_to_the_most_recent_day(self):
        self.assertEqual(self.doc["session"]["day"], "2026-09-12")
        self.assertEqual(self.doc["session"]["runs"],
                         self.doc["days"]["2026-09-12"])

    def test_document_is_json_serialisable(self):
        json.dumps(self.doc, default=float)


if __name__ == "__main__":
    unittest.main()
