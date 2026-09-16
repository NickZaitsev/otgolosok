#!/usr/bin/env python3
"""Import a versioned Moscow attraction catalog from an OSM PBF."""

import argparse
import hashlib
import json
from pathlib import Path

import osmium

FIELDS = ("name", "name:ru", "tourism", "historic", "heritage", "leisure", "amenity",
          "building", "addr:street", "addr:housenumber", "wikidata", "wikipedia", "architect")
TOURISM = {"attraction", "museum", "gallery", "artwork", "viewpoint", "zoo", "theme_park"}
LEISURE = {"park", "garden"}


def selected(tags):
    values = {key: tags[key] for key in FIELDS if tags.get(key)}
    named = bool(values.get("name") or values.get("name:ru"))
    eligible = (values.get("historic", "no") != "no" or values.get("heritage", "no") != "no"
                or values.get("tourism") in TOURISM or (named and values.get("leisure") in LEISURE)
                or (values.get("building") not in (None, "no") and
                    any(values.get(key) for key in ("wikidata", "wikipedia", "architect"))))
    return values if eligible and named else None


class Attractions(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.items = []; self.latest = ""; self.skipped = 0

    def add(self, kind, osm_id, tags, points, timestamp):
        if not points:
            self.skipped += 1; return
        lat = round((min(p[0] for p in points) + max(p[0] for p in points)) / 2, 7)
        lon = round((min(p[1] for p in points) + max(p[1] for p in points)) / 2, 7)
        # Guard rail only. Administrative boundary clipping can be added once a
        # verified relation and full-coverage extract are selected for production.
        if 55.05 <= lat <= 56.05 and 36.75 <= lon <= 38.25:
            self.items.append({"placeId": f"osm:{kind}:{osm_id}", "osmType": kind, "osmId": osm_id,
                               "name": tags.get("name:ru", tags.get("name")), "location": {"lat": lat, "lon": lon}, "tags": tags})
            self.latest = max(self.latest, timestamp.isoformat())

    def node(self, node):
        tags = selected(node.tags)
        if tags: self.add("node", node.id, tags, [(node.lat, node.lon)], node.timestamp)

    def way(self, way):
        tags = selected(way.tags)
        if tags: self.add("way", way.id, tags, [(n.lat, n.lon) for n in way.nodes if n.location.valid()], way.timestamp)

    def area(self, area):
        if area.from_way(): return
        tags = selected(area.tags)
        if tags: self.add("relation", area.orig_id(), tags, [(n.lat, n.lon) for ring in area.outer_rings() for n in ring], area.timestamp)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf", type=Path)
    parser.add_argument("--output", type=Path, default=Path("backend/data/osm-attractions.json"))
    args = parser.parse_args(); handler = Attractions()
    handler.apply_file(str(args.pbf), locations=True, idx="flex_mem")
    if not handler.items: raise SystemExit("No attractions found; refusing to replace catalog")
    with args.pbf.open("rb") as source:
        checksum = hashlib.file_digest(source, "sha256").hexdigest()
    result = {"schemaVersion": 1, "rulesVersion": "moscow-attractions-v1", "source": str(args.pbf),
              "sourceSha256": checksum, "latestEdit": handler.latest,
              "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors",
              "coverage": "moscow-bounding-box; administrative clipping pending verified boundary",
              "places": sorted(handler.items, key=lambda item: item["placeId"])}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(handler.items)} attractions; skipped {handler.skipped} incomplete geometries: {args.output}")


if __name__ == "__main__": main()
