#!/usr/bin/env python3
"""Import a versioned Moscow attraction catalog from an OSM PBF."""

import argparse
import hashlib
import json
import math
import re
from pathlib import Path

try:
    import osmium
except ModuleNotFoundError:  # Pure helper tests do not need the PBF parser.
    osmium = None

FIELDS = ("name", "name:ru", "tourism", "historic", "heritage", "leisure", "amenity",
          "building", "addr:street", "addr:housenumber", "wikidata", "wikipedia", "architect")
TOURISM = {"attraction", "museum", "gallery", "artwork", "viewpoint", "zoo", "theme_park"}
LEISURE = {"park", "garden"}
TOKEN = re.compile(r"[\wа-яё]+", re.I)


def distance(a, b):
    lat = math.radians((a["location"]["lat"] + b["location"]["lat"]) / 2)
    dx = math.radians(a["location"]["lon"] - b["location"]["lon"]) * math.cos(lat)
    dy = math.radians(a["location"]["lat"] - b["location"]["lat"])
    return 6371000 * math.sqrt(dx * dx + dy * dy)


def duplicate_candidates(items):
    """Conservative review list; importer never merges distinct OSM objects."""
    by_wikidata = {}
    for item in items:
        qid = item["tags"].get("wikidata")
        if qid: by_wikidata.setdefault(qid, []).append(item["placeId"])
    result = [{"reason": "wikidata", "value": qid, "placeIds": ids}
              for qid, ids in by_wikidata.items() if len(ids) > 1]
    # Only compare nearby normalized names; avoid quadratic comparison across Moscow.
    buckets = {}
    for item in items:
        name = " ".join(TOKEN.findall(item["name"].casefold().replace("ё", "е")))
        if name: buckets.setdefault(name, []).append(item)
    for name, group in buckets.items():
        if len(group) < 2: continue
        for index, left in enumerate(group):
            near = [right["placeId"] for right in group[index + 1:] if distance(left, right) <= 30]
            if near: result.append({"reason": "nearby_name", "value": name, "placeIds": [left["placeId"], *near]})
    return result


def point_in_geometry(point, geometry):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    def inside(ring):
        x, y = point["lon"], point["lat"]; contained = False
        for index, a in enumerate(ring):
            b = ring[index - 1]
            if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]: contained = not contained
        return contained
    return any(inside(polygon[0]) and not any(inside(hole) for hole in polygon[1:]) for polygon in polygons)


def selected(tags):
    values = {key: tags[key] for key in FIELDS if tags.get(key)}
    named = bool(values.get("name") or values.get("name:ru"))
    eligible = (values.get("historic", "no") != "no" or values.get("heritage", "no") != "no"
                or values.get("tourism") in TOURISM or (named and values.get("leisure") in LEISURE)
                or (values.get("building") not in (None, "no") and
                    any(values.get(key) for key in ("wikidata", "wikipedia", "architect"))))
    return values if eligible and named else None


class Attractions(osmium.SimpleHandler if osmium else object):
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
    if osmium is None: raise SystemExit("Install pyosmium before importing a PBF")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf", type=Path)
    parser.add_argument("--output", type=Path, default=Path("backend/data/osm-attractions.json"))
    parser.add_argument("--coverage", choices=("bounding-box", "moscow-admin"), default="bounding-box")
    parser.add_argument("--boundary-file", type=Path, help="GeoJSON Polygon/MultiPolygon for verified Moscow boundary")
    args = parser.parse_args(); handler = Attractions()
    if args.coverage == "moscow-admin" and not args.boundary_file:
        raise SystemExit("--coverage moscow-admin requires --boundary-file")
    handler.apply_file(str(args.pbf), locations=True, idx="flex_mem")
    if not handler.items: raise SystemExit("No attractions found; refusing to replace catalog")
    with args.pbf.open("rb") as source:
        checksum = hashlib.file_digest(source, "sha256").hexdigest()
    items = sorted(handler.items, key=lambda item: item["placeId"])
    boundary_checksum = None
    if args.boundary_file:
        boundary_bytes = args.boundary_file.read_bytes(); boundary_checksum = hashlib.sha256(boundary_bytes).hexdigest(); boundary = json.loads(boundary_bytes)
        geometry = boundary["features"][0]["geometry"] if boundary.get("type") == "FeatureCollection" else boundary.get("geometry", boundary)
        items = [item for item in items if point_in_geometry(item["location"], geometry)]
        if not items: raise SystemExit("Verified boundary removed every attraction; refusing output")
    categories = {}
    for item in items:
        category = next((f"{key}={item['tags'][key]}" for key in ("tourism", "historic", "heritage", "leisure", "building") if item["tags"].get(key)), "other")
        categories[category] = categories.get(category, 0) + 1
    result = {"schemaVersion": 1, "rulesVersion": "moscow-attractions-v1", "source": str(args.pbf),
              "sourceSha256": checksum, "latestEdit": handler.latest,
              "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors",
              "coverage": "moscow-admin" if args.coverage == "moscow-admin" else "moscow-bounding-box; administrative clipping pending verified boundary",
              "boundary": {"file": str(args.boundary_file), "sha256": boundary_checksum} if args.boundary_file else None,
              "report": {"categories": categories, "skippedGeometry": handler.skipped,
                         "duplicateCandidates": duplicate_candidates(items)}, "places": items}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(handler.items)} attractions; skipped {handler.skipped} incomplete geometries: {args.output}")


if __name__ == "__main__": main()
