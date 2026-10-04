import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing, nullcontext
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "food_index", Path(__file__).with_name("build-osm-food-index.py")
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def tag_xml(tags):
    return "".join(f'<tag k="{key}" v="{value}"/>' for key, value in tags.items())


def node(identifier, lon, lat, tags=None, timestamp="2026-09-01T00:00:00Z"):
    return f'<node id="{identifier}" lon="{lon}" lat="{lat}" version="1" timestamp="{timestamp}">{tag_xml(tags or {})}</node>'


def way(identifier, refs, tags):
    return (
        f'<way id="{identifier}" version="1" timestamp="2026-09-02T00:00:00Z">'
        + "".join(f'<nd ref="{ref}"/>' for ref in refs)
        + tag_xml(tags)
        + "</way>"
    )


class FoodIndexTest(unittest.TestCase):
    def test_tag_mapping_and_exclusions(self):
        cases = [
            ({"amenity": "cafe", "cuisine": "coffee_shop"}, "coffee"),
            ({"amenity": "cafe", "cuisine": "cake; coffee_shop"}, "coffee"),
            ({"amenity": "cafe", "cuisine": "not_coffee_shop"}, "cafe"),
            ({"amenity": "cafe"}, "cafe"),
            ({"amenity": "restaurant"}, "restaurant"),
            *[
                ({"amenity": value}, "fast_food")
                for value in ("fast_food", "food_court", "ice_cream")
            ],
            *[({"shop": value}, "bakery") for value in ("bakery", "pastry")],
            *[({"amenity": value}, "bar") for value in ("bar", "pub", "biergarten")],
            ({"shop": "coffee"}, None),
            ({"shop": "coffee", "drink:coffee": "yes"}, None),
            ({"amenity": "school"}, None),
            *[
                ({"amenity": "cafe", "access": value}, None)
                for value in ("private", "no")
            ],
            *[
                ({"amenity": "cafe", "opening_hours": value}, None)
                for value in ("closed", "off", " OFF ")
            ],
            *[
                ({"amenity": "cafe", key + "amenity": "cafe"}, None)
                for key in ("disused:", "abandoned:", "was:")
            ],
            ({"amenity": "cafe", "name": " "}, None),
            ({"amenity": "cafe", "name": "", "name:ru": "Кофейня"}, None),
            ({"amenity": "cafe", "opening_hours": "Mo off"}, "cafe"),
            ({"amenity": "cafe", "access": "customers"}, "cafe"),
        ]
        for tags, expected in cases:
            with self.subTest(tags=tags):
                self.assertEqual(MODULE.food_kind({"name": "Кафе", **tags}), expected)
        self.assertIsNone(MODULE.food_kind({"amenity": "cafe"}))

    def test_website_and_address(self):
        for value, expected in [
            (None, None),
            ("", None),
            ("example.org", None),
            ("javascript:alert(1)", None),
            ("ftp://example.org", None),
            ("https:///a", None),
            ("http://[invalid", None),
            ("https://example.org:wrong", None),
            ("https://user:pass@example.org", None),
            ("https://example.org/a b", None),
            ("https://example.org/\nx", None),
            (" https://example.org/a ", "https://example.org/a"),
            ("http://example.org", "http://example.org"),
        ]:
            with self.subTest(value=value):
                self.assertEqual(MODULE.website(value), expected)
        for tags, expected in [
            ({}, None),
            ({"addr:street": "Улица"}, None),
            ({"addr:housenumber": "1"}, None),
            ({"addr:street": " ", "addr:housenumber": "1"}, None),
            (
                {
                    "addr:street": " Улица ",
                    "addr:housenumber": "24/7 с1",
                    "addr:city": "Москва",
                },
                "Улица, 24/7 с1",
            ),
            (
                {
                    "addr:full": " Полный адрес ",
                    "addr:street": "Улица",
                    "addr:housenumber": "1",
                },
                "Полный адрес",
            ),
        ]:
            with self.subTest(tags=tags):
                self.assertEqual(MODULE.postal_address(tags), expected)

    def test_representative_point_handles_concavity_holes_and_multipolygons(self):
        square = [(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)]
        hole = [(1, 1), (3, 1), (3, 3), (1, 3), (1, 1)]
        concave = [(0, 0), (4, 0), (4, 1), (1, 1), (1, 4), (0, 4), (0, 0)]
        other = [(10, 0), (14, 0), (14, 4), (10, 4), (10, 0)]
        self.assertEqual(MODULE.representative_point([[square]]), (2, 2))
        for polygons in ([[square, hole]], [[concave]], [[square], [other]]):
            with self.subTest(polygons=polygons):
                point = MODULE.representative_point(polygons)
                self.assertTrue(MODULE.in_polygons(point, polygons))
                if polygons == [[square, hole]]:
                    self.assertFalse(MODULE.in_ring(point, hole))
        for polygons in ([], [[[(0, 0), (1, 1), (2, 2), (0, 0)]]], [[square[:-1]]]):
            with self.subTest(polygons=polygons), self.assertRaises(ValueError):
                MODULE.representative_point(polygons)

    def test_import_metadata_deduplication_and_incomplete_geometry(self):
        coffee = {"name": "Кофейня", "amenity": "cafe", "cuisine": "coffee_shop"}
        nodes = node(
            1,
            37.61,
            55.75,
            {
                **coffee,
                "opening_hours": "24/7",
                "website": "https://example.org",
                "addr:street": "Улица",
                "addr:housenumber": "1",
            },
        )
        nodes += (
            node(2, 37.60, 55.74)
            + node(3, 37.62, 55.74)
            + node(4, 37.62, 55.76)
            + node(5, 37.60, 55.76)
        )
        nodes += node(6, 37.61, 55.755, {"name": "Другое", "amenity": "cafe"})
        nodes += node(7, 37.63, 55.75, coffee)
        ways = way(1, [2, 3, 4, 5, 2], coffee)
        ways += way(2, [2, 3, 4, 5, 2], {"name": "Пекарня", "shop": "bakery"})
        ways += way(3, [2, 999, 4, 5, 2], {"name": "Неполное", "amenity": "cafe"})
        ways += way(4, [2, 3], {"name": "Бар", "amenity": "bar"})
        relation = (
            '<relation id="1" version="1" timestamp="2026-09-03T00:00:00Z"><member type="way" ref="2" role="outer"/>'
            + tag_xml(
                {"type": "multipolygon", "name": "Ресторан", "amenity": "restaurant"}
            )
            + "</relation>"
        )
        relation += (
            '<relation id="2" version="1"><member type="way" ref="999" role="outer"/>'
            + tag_xml({"type": "multipolygon", **coffee})
            + "</relation>"
        )
        with tempfile.TemporaryDirectory() as directory:
            source, output = (
                Path(directory) / "fixture.osm",
                Path(directory) / "index.sqlite",
            )
            source.write_text(
                '<osm version="0.6">' + nodes + ways + relation + "</osm>",
                encoding="utf-8",
            )
            result = MODULE.build(source, output)
            self.assertEqual(
                result["counts_by_kind"],
                {
                    "coffee": 2,
                    "cafe": 1,
                    "restaurant": 1,
                    "fast_food": 0,
                    "bakery": 1,
                    "bar": 1,
                },
            )
            self.assertEqual(result["duplicates_removed"], 1)
            self.assertEqual(result["skipped_geometry"], 2)
            self.assertEqual(result["with_opening_hours"], 1)
            self.assertEqual(
                result["source_sha256"], hashlib.sha256(source.read_bytes()).hexdigest()
            )
            self.assertTrue(result["source_edited_at"].startswith("2026-09-03"))
            with closing(sqlite3.connect(output)) as db:
                self.assertEqual(
                    db.execute("PRAGMA integrity_check").fetchone()[0], "ok"
                )
                self.assertEqual(
                    db.execute(
                        "SELECT address,opening_hours,website FROM places WHERE id='osm:node:1'"
                    ).fetchone(),
                    ("Улица, 1", "24/7", "https://example.org"),
                )
                self.assertIsNone(
                    db.execute("SELECT id FROM places WHERE id='osm:way:1'").fetchone()
                )
                self.assertEqual(
                    db.execute(
                        "SELECT lat,lon FROM places WHERE id='osm:way:2'"
                    ).fetchone(),
                    (55.75, 37.61),
                )
                self.assertEqual(
                    json.loads(
                        dict(db.execute("SELECT key,value FROM meta"))["counts_by_kind"]
                    ),
                    result["counts_by_kind"],
                )
            self.assertEqual(list(Path(directory).glob(".osm-food-*")), [])

    def test_deduplication_uses_containment_kind_name_and_raw_coordinates(self):
        coffee = {"name": "Кофе", "amenity": "cafe", "cuisine": "coffee_shop"}
        cases = [
            (37.61, 55.75, coffee, True),
            (37.62, 55.75, coffee, True),
            (37.620004, 55.75, coffee, False),
            (37.619999, 55.75, coffee, True),
            (37.61, 55.75, {**coffee, "name": "Другое"}, False),
            (37.61, 55.75, {**coffee, "amenity": "restaurant"}, False),
        ]
        for lon, lat, tags, duplicate in cases:
            with (
                self.subTest(lon=lon, tags=tags),
                tempfile.TemporaryDirectory() as directory,
            ):
                source, output = (
                    Path(directory) / "fixture.osm",
                    Path(directory) / "index.sqlite",
                )
                xml = node(1, lon, lat, tags)
                xml += (
                    node(2, 37.60, 55.74)
                    + node(3, 37.62, 55.74)
                    + node(4, 37.62, 55.76)
                    + node(5, 37.60, 55.76)
                )
                xml += way(1, [2, 3, 4, 5, 2], coffee)
                source.write_text(
                    '<osm version="0.6">' + xml + "</osm>", encoding="utf-8"
                )
                result = MODULE.build(source, output)
                self.assertEqual(result["duplicates_removed"], int(duplicate))
                self.assertTrue(
                    result["source_edited_at"].startswith(
                        "2026-09-01" if duplicate else "2026-09-02"
                    )
                )
                with closing(sqlite3.connect(output)) as db:
                    self.assertEqual(
                        db.execute("SELECT count(*) FROM places").fetchone()[0],
                        1 if duplicate else 2,
                    )
                    self.assertIsNotNone(
                        db.execute(
                            "SELECT id FROM places WHERE id='osm:node:1'"
                        ).fetchone()
                    )

    def test_failed_import_preserves_previous_file(self):
        for failure in ("empty", "missing", "malformed", "replace"):
            with (
                self.subTest(failure=failure),
                tempfile.TemporaryDirectory() as directory,
            ):
                source, output = (
                    Path(directory) / "fixture.osm",
                    Path(directory) / "index.sqlite",
                )
                output.write_bytes(b"previous-index")
                if failure == "empty":
                    source.write_text('<osm version="0.6"></osm>')
                elif failure == "malformed":
                    source.write_text("<osm><broken>")
                elif failure == "replace":
                    source.write_text(
                        '<osm version="0.6">'
                        + node(1, 37.61, 55.75, {"name": "Кафе", "amenity": "cafe"})
                        + "</osm>"
                    )
                with (
                    (
                        patch.object(
                            MODULE.os,
                            "replace",
                            side_effect=OSError("replacement failed"),
                        )
                        if failure == "replace"
                        else nullcontext()
                    ),
                    self.assertRaises((ValueError, RuntimeError, OSError)),
                ):
                    MODULE.build(source, output)
                self.assertEqual(output.read_bytes(), b"previous-index")
                self.assertEqual(list(Path(directory).glob(".osm-food-*")), [])


if __name__ == "__main__":
    unittest.main()
