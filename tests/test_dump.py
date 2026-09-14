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

    def test_document_is_json_serialisable(self):
        json.dumps(self.doc, default=float)


if __name__ == "__main__":
    unittest.main()
