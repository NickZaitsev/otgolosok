import hashlib
import importlib.util
import sqlite3
import tempfile
import unittest
from contextlib import closing, nullcontext
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "parking_index", Path(__file__).with_name("build-osm-parking-index.py")
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def tag_xml(tags):
    return "".join(f'<tag k="{key}" v="{value}"/>' for key, value in tags.items())


def node(identifier, lon, lat, tags=None):
    return (
        f'<node id="{identifier}" lon="{lon}" lat="{lat}" version="1" '
        f'timestamp="2026-10-01T00:00:00Z">{tag_xml(tags or {})}</node>'
    )


def way(identifier, refs, tags, timestamp="2026-10-02T00:00:00Z"):
    return (
        f'<way id="{identifier}" version="1" timestamp="{timestamp}">'
        + "".join(f'<nd ref="{ref}"/>' for ref in refs)
        + tag_xml(tags)
        + "</way>"
    )


def parking(identifier, refs, **tags):
    return way(
        identifier,
        refs,
        {"amenity": "parking", "parking": "surface", **tags},
    )


class ParkingIndexTest(unittest.TestCase):
    def test_access_fee_capacity_and_type_rules(self):
        for tags, expected in [
            ({}, "unknown"),
            ({"access": "yes"}, "public"),
            ({"access": "public"}, "public"),
            ({"access": "permissive"}, "public"),
            ({"access": "private"}, None),
            ({"access": "customers"}, None),
            ({"access": "strange"}, None),
            ({"access": "private", "vehicle": "yes"}, "public"),
            ({"vehicle": "private", "motor_vehicle": "yes"}, "public"),
        ]:
            with self.subTest(tags=tags):
                self.assertEqual(MODULE.access_kind(tags), expected)
        for value, expected in [("yes", "yes"), ("NO", "no"), (None, "unknown"), ("interval", "unknown")]:
            with self.subTest(value=value):
                self.assertEqual(MODULE.fee_kind(value), expected)
        for value, expected in [("1", 1), ("100000", 100000), ("0", None), ("100001", None), ("20;4", None), (None, None)]:
            with self.subTest(value=value):
                self.assertEqual(MODULE.capacity(value), expected)
        self.assertTrue(MODULE.is_surface_parking({"amenity": "parking", "parking": "surface"}))
        self.assertFalse(MODULE.is_surface_parking({"amenity": "parking"}))
        self.assertTrue(MODULE.is_access_road({"highway": "service"}))
        self.assertTrue(MODULE.is_access_road({"highway": "service", "service": "parking_aisle"}))
        self.assertFalse(MODULE.is_access_road({"highway": "service", "service": "alley"}))
        self.assertFalse(MODULE.is_access_road({"highway": "service", "access": "private"}))

    def test_build_uses_explicit_entrance_then_access_road_and_excludes_unsafe_places(self):
        points = [
            node(1, 37.6000, 55.7500, {"amenity": "parking_entrance"}),
            node(2, 37.6010, 55.7500),
            node(3, 37.6010, 55.7510),
            node(4, 37.6000, 55.7510),
            node(5, 37.6100, 55.7500),
            node(6, 37.6120, 55.7500),
            node(7, 37.6120, 55.7520),
            node(8, 37.6100, 55.7520),
            node(9, 37.6105, 55.7510),
            node(10, 37.6115, 55.7510),
            node(11, 37.6200, 55.7500),
            node(12, 37.6210, 55.7500),
            node(13, 37.6210, 55.7510),
            node(14, 37.6200, 55.7510),
            node(15, 37.6300, 55.7500),
            node(16, 37.6310, 55.7500),
            node(17, 37.6310, 55.7510),
            node(18, 37.6300, 55.7510),
            node(19, 37.6400, 55.7500),
            node(20, 37.6410, 55.7500),
            node(21, 37.6410, 55.7510),
            node(22, 37.6400, 55.7510),
        ]
        ways = [
            parking(100, [1, 2, 3, 4, 1], name="Парковка у музея", fee="yes", capacity="24", opening_hours="24/7"),
            parking(101, [5, 6, 7, 8, 5], access="yes", fee="no"),
            parking(102, [11, 12, 13, 14, 11], access="private"),
            way(103, [15, 16, 17, 18, 15], {"amenity": "parking", "parking": "underground"}),
            parking(104, [19, 20, 21, 22, 19]),
            way(200, [9, 10], {"highway": "service", "service": "parking_aisle"}),
        ]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "fixture.osm"
            output = Path(directory) / "parking.sqlite"
            source.write_text('<osm version="0.6">' + "".join(points + ways) + "</osm>", encoding="utf-8")
            result = MODULE.build(source, output, "https://example.test/map.pbf")
            self.assertEqual(result["count"], 2)
            self.assertEqual(result["surface_candidates"], 3)
            self.assertEqual(result["excluded_access"], 1)
            self.assertEqual(result["excluded_type"], 1)
            self.assertEqual(result["without_route_point"], 1)
            self.assertEqual(result["explicit_entrance"], 1)
            self.assertEqual(result["access_road"], 1)
            self.assertEqual(result["source_sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertEqual(result["source"], "https://example.test/map.pbf")
            with closing(sqlite3.connect(output)) as db:
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                rows = db.execute(
                    "SELECT id,name,access,fee,capacity,entrance_id,route_point_kind FROM places ORDER BY id"
                ).fetchall()
                self.assertEqual(
                    rows,
                    [
                        ("osm:way:100", "Парковка у музея", "unknown", "yes", 24, "osm:node:1", "entrance"),
                        ("osm:way:101", None, "public", "no", None, "osm:node:10", "road"),
                    ],
                )
            self.assertEqual(list(Path(directory).glob(".osm-parking-*")), [])

    def test_failed_build_preserves_previous_file(self):
        for failure in ("empty", "missing", "replace"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "fixture.osm"
                output = Path(directory) / "parking.sqlite"
                output.write_bytes(b"previous-index")
                if failure == "empty":
                    source.write_text('<osm version="0.6"></osm>')
                elif failure == "replace":
                    source.write_text(
                        '<osm version="0.6">'
                        + node(1, 37.60, 55.75, {"amenity": "parking_entrance"})
                        + node(2, 37.61, 55.75)
                        + node(3, 37.61, 55.76)
                        + node(4, 37.60, 55.76)
                        + parking(1, [1, 2, 3, 4, 1])
                        + "</osm>"
                    )
                with (
                    patch.object(MODULE.os, "replace", side_effect=OSError("replace failed"))
                    if failure == "replace"
                    else nullcontext(),
                    self.assertRaises((ValueError, RuntimeError, OSError)),
                ):
                    MODULE.build(source, output)
                self.assertEqual(output.read_bytes(), b"previous-index")
                self.assertEqual(list(Path(directory).glob(".osm-parking-*")), [])


if __name__ == "__main__":
    unittest.main()
