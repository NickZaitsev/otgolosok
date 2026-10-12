#!/usr/bin/env python3
"""Build the offline stop catalog of every covered city from the same OSM PBF as Valhalla.

Requires osmium==4.3.1 in a build-only Python environment; see content/walk-builder.md.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

import osmium

KEYS = ("name", "building", "addr:street", "addr:housenumber", "historic",
        "heritage", "tourism", "wikidata", "wikipedia", "architect")
REQUIRED = ("building", "addr:street", "addr:housenumber")
QID = re.compile(r"^Q[1-9][0-9]{0,15}$")
# Walk areas of the covered cities, shared with the backend.
CITIES = json.loads((Path(__file__).resolve().parents[1] / "backend/cities.json").read_text(encoding="utf-8"))["cities"]


def city_of(lat, lon):
    """The id of the city whose walk area holds the point, or None."""
    return next((city["id"] for city in CITIES if city["bounds"]["south"] <= lat <= city["bounds"]["north"]
                 and city["bounds"]["west"] <= lon <= city["bounds"]["east"]), None)


def notable(tags):
    """Signals that a building may carry researchable history.

    A name alone qualifies every shop and office tower, and many Moscow landmarks
    carry their title in the linked Wikidata item rather than in an OSM name tag.
    """
    return (tags.get("historic", "no") != "no"
            or tags.get("heritage", "no") != "no"
            or tags.get("tourism") == "museum"
            or bool(QID.match(tags.get("wikidata", "")))
            or bool(tags.get("wikipedia"))
            or bool(tags.get("architect")))


def building_tags(tags):
    selected = {key: tags[key] for key in KEYS if tags.get(key)}
    if not all(key in selected for key in REQUIRED) or selected["building"] == "no":
        return None
    return selected if notable(selected) else None


class Buildings(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.elements = []
        self.skipped_geometry = 0
        self.unaddressed = 0

    def count_unaddressed(self, tags):
        # An address is the only handle the story pipeline has on a building, and
        # OSM rarely carries one nearby when the outline itself lacks it.
        if tags.get("building") and tags["building"] != "no" and notable(tags) and not all(key in tags for key in REQUIRED):
            self.unaddressed += 1

    def add(self, kind, osm_id, tags, points, timestamp):
        if not points:
            self.skipped_geometry += 1
            return
        lat = round((min(p[0] for p in points) + max(p[0] for p in points)) / 2, 7)
        lon = round((min(p[1] for p in points) + max(p[1] for p in points)) / 2, 7)
        if city_of(lat, lon):
            self.elements.append({"type": kind, "id": osm_id, "center": {"lat": lat, "lon": lon}, "tags": tags,
                                  "timestamp": timestamp.isoformat()})

    def node(self, node):
        tags = building_tags(node.tags)
        if tags:
            self.add("node", node.id, tags, [(node.lat, node.lon)], node.timestamp)
        else:
            self.count_unaddressed(node.tags)

    def way(self, way):
        tags = building_tags(way.tags)
        if tags:
            points = [(n.lat, n.lon) for n in way.nodes] if all(n.location.valid() for n in way.nodes) else []
            self.add("way", way.id, tags, points, way.timestamp)
        else:
            self.count_unaddressed(way.tags)

    def area(self, area):
        if area.from_way():
            return
        tags = building_tags(area.tags)
        if tags:
            points = [(n.lat, n.lon) for ring in area.outer_rings() for n in ring]
            self.add("relation", area.orig_id(), tags, points, area.timestamp)
        else:
            self.count_unaddressed(area.tags)


def render_catalog(catalog):
    """Serialise the catalog as JSON with one element per line, so diffs stay reviewable."""
    metadata = {key: value for key, value in catalog.items() if key != "elements"}
    records = ",\n".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in catalog["elements"])
    head = json.dumps(metadata, ensure_ascii=False, indent=2)
    return head[:-2] + ',\n  "elements": [\n' + records + "\n  ]\n}\n"


def merge_city(catalog, city_id, elements, source):
    """Replace one city's buildings and provenance; other cities stay byte-for-byte as they were."""
    if catalog.get("sources") is None:
        # The single-source format described only Moscow.
        catalog = {"generatedBy": catalog["generatedBy"], "license": catalog["license"], "attribution": catalog["attribution"],
                   "sources": {"moscow": {key: catalog[key] for key in ("source", "sourceSha256", "latestBuildingEdit")}},
                   "elements": catalog["elements"]}
    kept = [e for e in catalog["elements"] if city_of(e["center"]["lat"], e["center"]["lon"]) != city_id]
    return {**catalog, "sources": {**catalog["sources"], city_id: source},
            "elements": sorted(kept + [e for e in elements if city_of(e["center"]["lat"], e["center"]["lon"]) == city_id],
                               key=lambda e: (e["type"], e["id"]))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf", type=Path)
    parser.add_argument("--city", required=True, choices=sorted(city["id"] for city in CITIES),
                        help="City whose buildings are rebuilt; the catalog keeps the others")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "backend/walk-discovery-catalog.json")
    parser.add_argument("--source-url", required=True, help="Download URL or description of the PBF, recorded as provenance")
    args = parser.parse_args()
    handler = Buildings()
    handler.apply_file(str(args.pbf), locations=True, idx="flex_mem")
    found = [e for e in handler.elements if city_of(e["center"]["lat"], e["center"]["lon"]) == args.city]
    if not found:
        raise SystemExit(f"No eligible buildings in {args.city}; refusing to replace the catalog")
    with args.pbf.open("rb") as source:
        checksum = hashlib.file_digest(source, "sha256").hexdigest()
    latest = max(e["timestamp"] for e in found)
    elements = [{key: value for key, value in e.items() if key != "timestamp"} for e in found]
    catalog = merge_city(json.loads(args.output.read_text(encoding="utf-8")), args.city, elements,
                         {"source": args.source_url, "sourceSha256": checksum, "latestBuildingEdit": latest})
    args.output.write_text(render_catalog(catalog), encoding="utf-8", newline="\n")
    print(f"Wrote {len(elements)} {args.city} buildings, {len(catalog['elements'])} in total; skipped {handler.unaddressed} "
          f"notable buildings without an address and {handler.skipped_geometry} incomplete geometries: {args.output}")


if __name__ == "__main__":
    main()
