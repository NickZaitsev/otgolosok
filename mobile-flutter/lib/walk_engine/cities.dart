// The cities the catalog covers. Source of truth: backend/cities.json (read by
// backend/cities.mjs); keep these values identical when that file changes.
// Areas do not overlap, so a coordinate belongs to at most one city.

class CityBounds {
  const CityBounds({
    required this.south,
    required this.north,
    required this.west,
    required this.east,
  });

  final double south;
  final double north;
  final double west;
  final double east;

  /// `insideBounds` of backend/cities.mjs: only finite numbers can be inside.
  bool contains(Object? lat, Object? lon) =>
      lat is num &&
      lon is num &&
      lat.isFinite &&
      lon.isFinite &&
      lat >= south &&
      lat <= north &&
      lon >= west &&
      lon <= east;
}

class City {
  const City({
    required this.id,
    required this.name,
    required this.nameEn,
    required this.inName,
    required this.bounds,
    required this.region,
    required this.centerLat,
    required this.centerLon,
    required this.zoom,
  });

  final String id;
  final String name;
  final String nameEn;
  final String inName;

  /// Where walks and stops may lie.
  final CityBounds bounds;

  /// The wider catalog area with the outskirts.
  final CityBounds region;
  final double centerLat;
  final double centerLon;
  final int zoom;
}

const List<City> cities = [
  City(
    id: 'moscow',
    name: 'Москва',
    nameEn: 'Moscow',
    inName: 'в Москве',
    bounds: CityBounds(south: 55.48, north: 55.98, west: 37.3, east: 37.95),
    region: CityBounds(south: 55.05, north: 56.05, west: 36.75, east: 38.25),
    centerLat: 55.752,
    centerLon: 37.6175,
    zoom: 14,
  ),
  City(
    id: 'kazan',
    name: 'Казань',
    nameEn: 'Kazan',
    inName: 'в Казани',
    bounds: CityBounds(south: 55.6, north: 55.94, west: 48.82, east: 49.39),
    region: CityBounds(south: 55.55, north: 55.99, west: 48.77, east: 49.44),
    centerLat: 55.7963,
    centerLon: 49.1088,
    zoom: 15,
  ),
];

/// The city whose walk area holds the point.
City? cityAt(Object? lat, Object? lon) {
  for (final city in cities) {
    if (city.bounds.contains(lat, lon)) return city;
  }
  return null;
}

/// The city whose catalog region holds the point.
City? regionCityAt(Object? lat, Object? lon) {
  for (final city in cities) {
    if (city.region.contains(lat, lon)) return city;
  }
  return null;
}

City? cityByName(Object? name) {
  for (final city in cities) {
    if (city.name == name) return city;
  }
  return null;
}
