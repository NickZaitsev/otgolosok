import importlib.util
import pathlib
import unittest

PATH=pathlib.Path(__file__).with_name("import-osm-attractions.py")
SPEC=importlib.util.spec_from_file_location("osm_import",PATH)
MODULE=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class ImporterTest(unittest.TestCase):
    def test_rules_include_addressless_attractions(self):
        self.assertEqual(MODULE.selected({"name":"Парк","leisure":"park"})["leisure"],"park")
        self.assertEqual(MODULE.selected({"name":"Дом","building":"yes","architect":"Автор"})["building"],"yes")
        self.assertIsNone(MODULE.selected({"name":"Дом","building":"yes"}))
    def test_duplicate_candidates_are_conservative(self):
        items=[{"placeId":"osm:node:1","name":"Памятник","location":{"lat":55.75,"lon":37.61},"tags":{"wikidata":"Q1"}},
               {"placeId":"osm:way:2","name":"памятник","location":{"lat":55.75001,"lon":37.61001},"tags":{"wikidata":"Q1"}}]
        self.assertEqual({item["reason"] for item in MODULE.duplicate_candidates(items)},{"wikidata","nearby_name"})
    def test_boundary_excludes_holes_and_outside_points(self):
        geometry={"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[4,4],[6,4],[6,6],[4,6],[4,4]]]}
        self.assertTrue(MODULE.point_in_geometry({"lat":2,"lon":2},geometry))
        self.assertFalse(MODULE.point_in_geometry({"lat":5,"lon":5},geometry))
        self.assertFalse(MODULE.point_in_geometry({"lat":20,"lon":20},geometry))

if __name__=="__main__":unittest.main()
