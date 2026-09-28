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
