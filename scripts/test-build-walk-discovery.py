import importlib.util
import json
import pathlib
import unittest

PATH = pathlib.Path(__file__).with_name("build-walk-discovery.py")
CATALOG = PATH.parents[1] / "backend" / "walk-discovery-catalog.json"
SPEC = importlib.util.spec_from_file_location("walk_discovery", PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CityTest(unittest.TestCase):
    def test_buildings_belong_to_a_covered_city_or_none(self):
        for lat, lon, expected in ((55.75, 37.61, "moscow"), (55.79, 49.12, "kazan"), (55.3, 37.61, None), (55.8, 43.0, None)):
            with self.subTest(lat=lat, lon=lon):
                self.assertEqual(MODULE.city_of(lat, lon), expected)


MOSCOW_BUILDING = {"type": "way", "id": 1, "center": {"lat": 55.75, "lon": 37.61}, "tags": {}}
KAZAN_BUILDING = {"type": "way", "id": 2, "center": {"lat": 55.79, "lon": 49.12}, "tags": {}}
LEGACY = {"generatedBy": "g", "source": "moscow.pbf", "sourceSha256": "a" * 64, "latestBuildingEdit": "2026-09-10",
          "license": "ODbL-1.0", "attribution": "OSM", "elements": [MOSCOW_BUILDING]}


class MergeCityTest(unittest.TestCase):

    def test_legacy_catalog_becomes_moscow_source_and_keeps_moscow(self):
        kazan = {"source": "kazan.pbf", "sourceSha256": "b" * 64, "latestBuildingEdit": "2026-10-11"}
        merged = MODULE.merge_city(LEGACY, "kazan", [KAZAN_BUILDING, MOSCOW_BUILDING], kazan)
        self.assertEqual(merged["sources"], {"moscow": {"source": "moscow.pbf", "sourceSha256": "a" * 64, "latestBuildingEdit": "2026-09-10"},
                                             "kazan": kazan})
        self.assertEqual(merged["elements"], [MOSCOW_BUILDING, KAZAN_BUILDING])
        self.assertNotIn("source", merged)

    def test_rebuilding_a_city_replaces_only_its_buildings(self):
        first = MODULE.merge_city(LEGACY, "kazan", [KAZAN_BUILDING], {"source": "k1"})
        replacement = {**KAZAN_BUILDING, "id": 3}
        second = MODULE.merge_city(first, "kazan", [replacement], {"source": "k2"})
        self.assertEqual(second["elements"], [MOSCOW_BUILDING, replacement])
        self.assertEqual(second["sources"]["kazan"], {"source": "k2"})
        self.assertEqual(second["sources"]["moscow"], first["sources"]["moscow"])


class RenderCatalogTest(unittest.TestCase):
    def test_writes_json_with_one_element_per_line(self):
        catalog = {"source": "osm", "elements": [
            {"type": "node", "id": 1, "tags": {"name": "Дом"}},
            {"type": "way", "id": 2, "tags": {}},
        ]}
        text = MODULE.render_catalog(catalog)
        self.assertEqual(json.loads(text), catalog)
        self.assertIn('\n{"type":"node","id":1,"tags":{"name":"Дом"}},\n', text)
        self.assertTrue(text.endswith("\n  ]\n}\n"))

    def test_empty_catalog_is_still_valid_json(self):
        self.assertEqual(json.loads(MODULE.render_catalog({"source": "osm", "elements": []}))["elements"], [])

    def test_committed_catalog_is_unedited_generator_output(self):
        text = CATALOG.read_text(encoding="utf-8")
        self.assertEqual(MODULE.render_catalog(json.loads(text)), text)


if __name__ == "__main__":
    unittest.main()
