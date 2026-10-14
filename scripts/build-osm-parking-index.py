#!/usr/bin/env python3
"""Собрать индекс общедоступных наземных парковок из OSM PBF (osmium==4.3.1)."""

import argparse
import hashlib
import itertools
import json
import math
import os
import sqlite3
import tempfile
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

try:
    import osmium
except ModuleNotFoundError:  # Pure helpers can be tested without pyosmium.
    osmium = None

SOURCE = "https://download.bbbike.org/osm/bbbike/Moscow/Moscow.osm.pbf"
ALLOWED_ACCESS = {"yes", "public", "permissive"}
RESTRICTED_ACCESS = {
    "no",
    "private",
    "customers",
    "permit",
    "residents",
    "destination",
    "delivery",
    "employees",
}
GRID_SIZE = 0.005


def text(value):
    return value.strip() if value and value.strip() else None


def access_kind(tags):
    """Return public/unknown, or None for a known restriction/unsupported value."""
    value = next(
        (text(tags.get(key)) for key in ("motor_vehicle", "vehicle", "access") if text(tags.get(key))),
        None,
    )
    if value is None:
        return "unknown"
    value = value.lower()
    if value in ALLOWED_ACCESS:
        return "public"
    if value in RESTRICTED_ACCESS:
        return None
    # Do not silently reinterpret an unfamiliar, explicit access rule as public.
    return None


def fee_kind(value):
    value = (text(value) or "").lower()
    if value in {"yes", "no"}:
        return value
    return "unknown"


def capacity(value):
    value = text(value)
    if not value or not value.isdecimal():
        return None
    parsed = int(value)
    return parsed if 0 < parsed <= 100_000 else None


def is_surface_parking(tags):
    return tags.get("amenity") == "parking" and tags.get("parking") == "surface"


def is_access_road(tags):
    return (
        tags.get("highway") == "service"
        and tags.get("service") in (None, "", "parking_aisle", "driveway")
        and access_kind(tags) is not None
    )


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
                if right > left and in_polygons(point, polygons) and (
                    best is None or right - left > best[0]
                ):
                    best = (right - left, point)
    if best is None:
        raise ValueError("Нет точки внутри полигона")
    return best[1]


def grid_key(point):
    return math.floor(point[0] / GRID_SIZE), math.floor(point[1] / GRID_SIZE)


def polygon_candidates(polygons, grid):
    xs = [x for polygon in polygons for ring in polygon for x, _ in ring]
    ys = [y for polygon in polygons for ring in polygon for _, y in ring]
    west, east = math.floor(min(xs) / GRID_SIZE), math.floor(max(xs) / GRID_SIZE)
    south, north = math.floor(min(ys) / GRID_SIZE), math.floor(max(ys) / GRID_SIZE)
    return itertools.chain.from_iterable(
        grid.get((x, y), ())
        for x in range(west, east + 1)
        for y in range(south, north + 1)
    )


_HandlerBase: type = osmium.SimpleHandler if osmium else object
_LocationError: type[Exception] = osmium.InvalidLocationError if osmium else ValueError


class ParkingIndex(_HandlerBase):
    def __init__(self, db):
        super().__init__()
        self.db = db
        self.areas = []
        self.entrances = []
        self.roads = []
        self.skipped_geometry = set()
        self.excluded_access = 0
        self.excluded_type = 0

    def node(self, node):
        tags = dict(node.tags)
        if tags.get("amenity") != "parking_entrance":
            return
        access = access_kind(tags)
        if access is None:
            return
        if not node.location.valid():
            self.skipped_geometry.add(f"osm:node:{node.id}")
            return
        self.entrances.append(
            {
                "id": f"osm:node:{node.id}",
                "point": (node.lon, node.lat),
                "access": access,
            }
        )

    def way(self, way):
        tags = dict(way.tags)
        if is_access_road(tags):
            try:
                for node, point in zip(way.nodes, coordinates(way.nodes)):
                    self.roads.append(
                        {"id": f"osm:node:{node.ref}", "point": point, "access": access_kind(tags)}
                    )
            except (ValueError, _LocationError):
                self.skipped_geometry.add(f"osm:way:{way.id}")
        if tags.get("amenity") == "parking" and tags.get("parking") != "surface":
            self.excluded_type += 1

    def relation(self, relation):
        tags = dict(relation.tags)
        if tags.get("amenity") == "parking" and tags.get("parking") != "surface":
            self.excluded_type += 1

    def area(self, area):
        tags = dict(area.tags)
        if not is_surface_parking(tags):
            return
        osm_id = f"osm:{'way' if area.from_way() else 'relation'}:{area.orig_id()}"
        access = access_kind(tags)
        if access is None:
            self.excluded_access += 1
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
            self.skipped_geometry.add(osm_id)
            return
        self.areas.append(
            {
                "id": osm_id,
                "tags": tags,
                "polygons": polygons,
                "point": point,
                "access": access,
                "timestamp": area.timestamp.isoformat(),
            }
        )

    def finish(self):
        entrance_grid = defaultdict(list)
        road_grid = defaultdict(list)
        for candidate in self.entrances:
            entrance_grid[grid_key(candidate["point"])].append(candidate)
        for candidate in self.roads:
            road_grid[grid_key(candidate["point"])].append(candidate)
        used_explicit = used_road = no_route_point = 0
        timestamps = []
        for area in self.areas:
            candidates = [
                item
                for item in polygon_candidates(area["polygons"], entrance_grid)
                if in_polygons(item["point"], area["polygons"])
            ]
            route_kind = "entrance"
            if not candidates:
                candidates = [
                    item
                    for item in polygon_candidates(area["polygons"], road_grid)
                    if in_polygons(item["point"], area["polygons"])
                ]
                route_kind = "road"
            if not candidates:
                no_route_point += 1
                continue
            lon, lat = area["point"]
            route = min(
                candidates,
                key=lambda item: (item["point"][0] - lon) ** 2
                + (item["point"][1] - lat) ** 2,
            )
            if route_kind == "entrance":
                used_explicit += 1
            else:
                used_road += 1
            route_lon, route_lat = cast(tuple[float, float], route["point"])
            tags = area["tags"]
            self.db.execute(
                "INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    area["id"],
                    text(tags.get("name:ru")) or text(tags.get("name")),
                    round(lat, 6),
                    round(lon, 6),
                    round(route_lat, 6),
                    round(route_lon, 6),
                    area["access"],
                    fee_kind(tags.get("fee")),
                    text(tags.get("opening_hours")),
                    capacity(tags.get("capacity")),
                    route["id"],
                    route_kind,
                    text(tags.get("operator")),
                ),
            )
            timestamps.append(area["timestamp"])
        return {
            "count": len(timestamps),
            "surface_candidates": len(self.areas),
            "excluded_access": self.excluded_access,
            "excluded_type": self.excluded_type,
            "without_route_point": no_route_point,
            "explicit_entrance": used_explicit,
            "access_road": used_road,
            "skipped_geometry": len(self.skipped_geometry),
            "source_edited_at": max(timestamps) if timestamps else None,
        }


def build(pbf: Path, output: Path, source_url=SOURCE):
    if osmium is None:
        raise RuntimeError("Для сборки нужен osmium==4.3.1")
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=".osm-parking-", suffix=".sqlite", dir=output.parent
    )
    os.close(descriptor)
    db = None
    try:
        db = sqlite3.connect(temporary)
        db.executescript("""
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE places(
              id TEXT PRIMARY KEY,name TEXT,lat REAL NOT NULL,lon REAL NOT NULL,
              entrance_lat REAL NOT NULL,entrance_lon REAL NOT NULL,
              access TEXT NOT NULL,fee TEXT NOT NULL,opening_hours TEXT,capacity INTEGER,
              entrance_id TEXT NOT NULL,route_point_kind TEXT NOT NULL,operator TEXT
            );
        """)
        handler = ParkingIndex(db)
        handler.apply_file(str(pbf), locations=True, idx="flex_mem")
        stats = handler.finish()
        if not stats["count"]:
            raise ValueError("В снимке нет пригодных парковок; прежний индекс сохранён")
        with pbf.open("rb") as source:
            checksum = hashlib.file_digest(source, "sha256").hexdigest()
        manifest = {
            "format_version": 1,
            "source_sha256": checksum,
            "source_edited_at": stats.pop("source_edited_at"),
            "built_at": datetime.now(UTC).isoformat(),
            "source": source_url,
            "license": "ODbL-1.0",
            "attribution": "© OpenStreetMap contributors",
            **stats,
        }
        db.executemany(
            "INSERT INTO meta VALUES (?,?)",
            [(key, str(value)) for key, value in manifest.items()],
        )
        db.commit()
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Индекс парковок не прошёл проверку целостности")
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
        "--output", type=Path, default=Path("backend/data/osm-parking.sqlite")
    )
    parser.add_argument("--source-url", default=SOURCE)
    args = parser.parse_args()
    try:
        manifest = build(args.pbf, args.output, args.source_url)
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as error:
        parser.exit(1, f"Не удалось собрать индекс парковок: {error}\n")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
