#!/usr/bin/env python3
"""Собрать отдельный индекс заведений SQLite из OSM PBF (osmium==4.3.1)."""

import argparse
import hashlib
import itertools
import json
import math
import os
import sqlite3
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

try:
    import osmium
except ModuleNotFoundError:  # Pure helpers can be tested without pyosmium.
    osmium = None

SOURCE = "https://download.bbbike.org/osm/bbbike/Moscow/Moscow.osm.pbf"
KINDS = ("coffee", "cafe", "restaurant", "fast_food", "bakery", "bar")


def text(value):
    return value.strip() if value and value.strip() else None


def food_kind(tags):
    if not text(tags.get("name")):
        return None
    if tags.get("access") in ("private", "no"):
        return None
    if (tags.get("opening_hours") or "").strip().lower() in ("closed", "off"):
        return None
    if any(key.startswith(("disused:", "abandoned:", "was:")) for key in tags):
        return None
    amenity = tags.get("amenity")
    if amenity == "cafe":
        cuisine = {part.strip() for part in (tags.get("cuisine") or "").split(";")}
        return "coffee" if "coffee_shop" in cuisine else "cafe"
    if amenity == "restaurant":
        return "restaurant"
    if amenity in ("fast_food", "food_court", "ice_cream"):
        return "fast_food"
    if amenity in ("bar", "pub", "biergarten"):
        return "bar"
    if tags.get("shop") in ("bakery", "pastry"):
        return "bakery"
    return None


def website(value):
    value = text(value)
    if not value or any(char.isspace() or ord(char) < 32 for char in value):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
            return None
        if parsed.username is not None or parsed.password is not None:
            return None
        _ = parsed.port
        return value
    except ValueError:
        return None


def postal_address(tags):
    if text(tags.get("addr:full")):
        return text(tags["addr:full"])
    street, number = text(tags.get("addr:street")), text(tags.get("addr:housenumber"))
    return f"{street}, {number}" if street and number else None


def coordinates(nodes):
    if any(not node.location.valid() for node in nodes):
        raise ValueError("Неполная геометрия")
    points = [(node.lon, node.lat) for node in nodes]
    if not points or any(
        not math.isfinite(x) or not math.isfinite(y) or abs(x) > 180 or abs(y) > 90
        for x, y in points
    ):
        raise ValueError("Некорректные координаты")
    return points


def in_ring(point, ring):
    x, y = point
    inside = False
    for a, b in itertools.pairwise(ring):
        cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0])
        if (
            abs(cross) < 1e-14
            and min(a[0], b[0]) <= x <= max(a[0], b[0])
            and min(a[1], b[1]) <= y <= max(a[1], b[1])
        ):
            return True
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (
            b[1] - a[1]
        ) + a[0]:
            inside = not inside
    return inside


def in_polygons(point, polygons):
    return any(
        in_ring(point, polygon[0])
        and not any(in_ring(point, hole) for hole in polygon[1:])
        for polygon in polygons
    )


def ring_centroid(ring):
    # Translate coordinates to avoid cancellation for small Moscow buildings.
    origin_x, origin_y = ring[0]
    local = [(x - origin_x, y - origin_y) for x, y in ring]
    area = cx = cy = 0.0
    for (x, y), (u, v) in itertools.pairwise(local):
        cross = x * v - u * y
        area += cross
        cx += (x + u) * cross
        cy += (y + v) * cross
    if not area:
        raise ValueError("Полигон без площади")
    return abs(area / 2), (origin_x + cx / (3 * area), origin_y + cy / (3 * area))


def representative_point(polygons):
    total = cx = cy = 0.0
    for polygon in polygons:
        for index, ring in enumerate(polygon):
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("Незамкнутый полигон")
            area, (x, y) = ring_centroid(ring)
            weight = area if index == 0 else -area
            total += weight
            cx += x * weight
            cy += y * weight
    if total <= 0:
        raise ValueError("Полигон без площади")
    centroid = (cx / total, cy / total)
    if in_polygons(centroid, polygons):
        return centroid
    # Scan between vertex levels; paired intersections include courtyard holes.
    best = None
    for polygon in polygons:
        levels = sorted({y for ring in polygon for _, y in ring})
        for low, high in itertools.pairwise(levels):
            y = (low + high) / 2
            intersections = sorted(
                a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
                for ring in polygon
                for a, b in itertools.pairwise(ring)
                if (a[1] > y) != (b[1] > y)
            )
            for left, right in zip(intersections[::2], intersections[1::2]):
                point = ((left + right) / 2, y)
                if (
                    right > left
                    and in_polygons(point, polygons)
                    and (best is None or right - left > best[0])
                ):
                    best = (right - left, point)
    if best is None:
        raise ValueError("Нет точки внутри полигона")
    return best[1]


_HandlerBase: type = osmium.SimpleHandler if osmium else object
_LocationError: type[Exception] = osmium.InvalidLocationError if osmium else ValueError


class FoodIndex(_HandlerBase):
    def __init__(self, db):
        super().__init__()
        self.db = db
        self.skipped = set()
        self.pending = set()
        self.polygons = {}
        self.timestamps = {}
        self.node_points = {}

    def add(self, osm_id, kind, tags, point, timestamp):
        lon, lat = point
        if (
            not math.isfinite(lon)
            or not math.isfinite(lat)
            or abs(lon) > 180
            or abs(lat) > 90
        ):
            self.skipped.add(osm_id)
            return
        self.db.execute(
            "INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                osm_id,
                kind,
                text(tags.get("name:ru")) or text(tags["name"]),
                round(lat, 5),
                round(lon, 5),
                postal_address(tags),
                text(tags.get("opening_hours")),
                text(tags.get("cuisine")),
                website(tags.get("website") or tags.get("contact:website")),
                text(tags.get("phone") or tags.get("contact:phone")),
            ),
        )
        self.timestamps[osm_id] = timestamp.isoformat()
        if osm_id.startswith("osm:node:"):
            self.node_points[osm_id] = point
        self.pending.discard(osm_id)

    def node(self, node):
        tags = dict(node.tags)
        kind = food_kind(tags)
        if not kind:
            return
        osm_id = f"osm:node:{node.id}"
        if not node.location.valid():
            self.skipped.add(osm_id)
            return
        self.add(osm_id, kind, tags, (node.lon, node.lat), node.timestamp)

    def way(self, way):
        tags = dict(way.tags)
        kind = food_kind(tags)
        if not kind:
            return
        osm_id = f"osm:way:{way.id}"
        try:
            points = coordinates(way.nodes)
            if len(points) < 2:
                raise ValueError("Линия без сегментов")
        except (ValueError, _LocationError):
            self.skipped.add(osm_id)
            return
        if way.is_closed():
            self.pending.add(osm_id)
            return
        # Non-area ways use a real segment midpoint, as in the attraction importer.
        left, right = points[(len(points) - 2) // 2 : (len(points) - 2) // 2 + 2]
        self.add(
            osm_id,
            kind,
            tags,
            ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2),
            way.timestamp,
        )

    def relation(self, relation):
        if food_kind(dict(relation.tags)):
            self.pending.add(f"osm:relation:{relation.id}")

    def area(self, area):
        tags = dict(area.tags)
        kind = food_kind(tags)
        if not kind:
            return
        osm_id = f"osm:{'way' if area.from_way() else 'relation'}:{area.orig_id()}"
        if osm_id in self.skipped:
            return
        try:
            polygons = [
                [
                    coordinates(outer),
                    *[coordinates(inner) for inner in area.inner_rings(outer)],
                ]
                for outer in area.outer_rings()
            ]
            point = representative_point(polygons)
        except (ValueError, _LocationError):
            self.skipped.add(osm_id)
            return
        self.add(osm_id, kind, tags, point, area.timestamp)
        if area.from_way():
            self.polygons[osm_id] = polygons

    def finish(self):
        # Match only name/kind peers; never merge nearby branches of a chain.
        nodes = {}
        for osm_id, kind, name, lon, lat in self.db.execute(
            "SELECT id,kind,name,lon,lat FROM places WHERE id LIKE 'osm:node:%'"
        ):
            nodes.setdefault((kind, name), []).append(self.node_points[osm_id])
        duplicates = 0
        for osm_id, polygons in self.polygons.items():
            kind, name = self.db.execute(
                "SELECT kind,name FROM places WHERE id=?", (osm_id,)
            ).fetchone()
            if any(
                in_polygons(point, polygons) for point in nodes.get((kind, name), [])
            ):
                self.db.execute("DELETE FROM places WHERE id=?", (osm_id,))
                del self.timestamps[osm_id]
                duplicates += 1
        self.skipped.update(self.pending)
        return duplicates


def build(pbf: Path, output: Path, source_url=SOURCE):
    if osmium is None:
        raise RuntimeError("Для сборки нужен osmium==4.3.1")
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=".osm-food-", suffix=".sqlite", dir=output.parent
    )
    os.close(descriptor)
    db = None
    try:
        db = sqlite3.connect(temporary)
        db.executescript("""
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE places(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,address TEXT,opening_hours TEXT,cuisine TEXT,website TEXT,phone TEXT);
        """)
        handler = FoodIndex(db)
        handler.apply_file(str(pbf), locations=True, idx="flex_mem")
        duplicates = handler.finish()
        counts = dict.fromkeys(KINDS, 0)
        counts.update(
            dict(db.execute("SELECT kind,count(*) FROM places GROUP BY kind"))
        )
        if not sum(counts.values()):
            raise ValueError("В снимке нет заведений; прежний индекс сохранён")
        with pbf.open("rb") as source:
            checksum = hashlib.file_digest(source, "sha256").hexdigest()
        manifest = {
            "format_version": 1,
            "source_sha256": checksum,
            "source_edited_at": max(handler.timestamps.values()),
            "built_at": datetime.now(UTC).isoformat(),
            "counts_by_kind": counts,
            "source": source_url,
            "license": "ODbL-1.0",
            "attribution": "© OpenStreetMap contributors",
            "skipped_geometry": len(handler.skipped),
            "duplicates_removed": duplicates,
            "with_opening_hours": db.execute(
                "SELECT count(*) FROM places WHERE opening_hours IS NOT NULL"
            ).fetchone()[0],
        }
        db.executemany(
            "INSERT INTO meta VALUES (?,?)",
            [
                (
                    key,
                    json.dumps(value, ensure_ascii=False)
                    if isinstance(value, dict)
                    else str(value),
                )
                for key, value in manifest.items()
            ],
        )
        db.commit()
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Индекс заведений не прошёл проверку целостности")
        db.close()
        db = None
        os.chmod(temporary, 0o644)
        os.replace(temporary, output)
        return manifest
    finally:
        if db is not None:
            db.close()
        Path(temporary).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf", type=Path)
    parser.add_argument(
        "--output", type=Path, default=Path("backend/data/osm-food.sqlite")
    )
    parser.add_argument("--source-url", default=SOURCE)
    args = parser.parse_args()
    try:
        manifest = build(args.pbf, args.output, args.source_url)
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as error:
        parser.exit(1, f"Не удалось собрать индекс заведений: {error}\n")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
