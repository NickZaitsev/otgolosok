import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../../core/i18n/translations.dart';
import '../../walk_engine/json_read.dart';
import '../reviews/review_model.dart';
import 'format.dart';

/// Port of `src/features/walks/top-model.ts`: the public top (`GET /api/top-walks`).
/// Validators fail closed with a [FormatException], exactly where the site throws.

@immutable
class MetroLine {
  const MetroLine({required this.id, required this.name, required this.color});
  final String id;
  final String name;

  /// `#rrggbb`.
  final String color;

  Map<String, Object?> toJson() => {'color': color, 'id': id, 'name': name};
}

@immutable
class MetroStation {
  const MetroStation({required this.name, required this.distanceM, required this.lines});
  final String name;
  final int distanceM;
  final List<MetroLine> lines;

  Map<String, Object?> toJson() => {'distanceM': distanceM, 'lines': [for (final line in lines) line.toJson()], 'name': name};
}

/// A metro filter option: a station name or a zone such as [insideCircle]; a zone shows [label]
/// instead of the value and [hint] under it.
@immutable
class MetroOption {
  const MetroOption({required this.name, required this.lines, this.insideCircle = false, this.label, this.hint});
  final String name;
  final List<MetroLine> lines;
  final bool insideCircle;
  final String? label;
  final String? hint;

  bool get isZone => label != null;

  Map<String, Object?> toJson() => {'insideCircle': insideCircle, 'lines': [for (final line in lines) line.toJson()], 'name': name};
}

/// Filter value for every station on or inside the Circle line; station names never start with «@».
const insideCircle = '@circle';
const circleLine = MetroLine(id: '5', name: 'Кольцевая', color: '#915133');

@immutable
class MapTile {
  const MapTile({required this.x, required this.y, required this.left, required this.top});
  final int x;
  final int y;
  final double left;
  final double top;

  Map<String, Object?> toJson() => {'left': left, 'top': top, 'x': x, 'y': y};
}

/// A 256×256 map frame of OSM tiles with the route drawn in frame pixels.
@immutable
class MapPreview {
  const MapPreview({required this.zoom, required this.tiles, required this.points});
  final int zoom;
  final List<MapTile> tiles;
  final List<(double, double)> points;

  Map<String, Object?> toJson() => {
        'points': [for (final (x, y) in points) [x, y]],
        'tiles': [for (final tile in tiles) tile.toJson()],
        'zoom': zoom,
      };
}

enum TopWalkKind { catalog, shared }

/// One public walk; [rank] belongs to the unfiltered top.
@immutable
class TopWalk {
  const TopWalk({
    required this.kind,
    required this.id,
    required this.title,
    required this.walkingMinutes,
    required this.distanceM,
    required this.stopCount,
    required this.rating,
    required this.rank,
    this.driving = false,
    this.totalMinutes,
    this.preview,
    this.mapPreview,
    this.startMetro,
    this.endMetro,
  });

  final TopWalkKind kind;
  final String id;
  final String title;
  final bool driving;
  final double? totalMinutes;
  final double walkingMinutes;
  final double distanceM;
  final int stopCount;
  final ReviewSummary rating;
  final int rank;

  /// Route sketch in a 100×100 box, shown while the map preview is off or failed.
  final List<(double, double)>? preview;
  final MapPreview? mapPreview;
  final MetroStation? startMetro;
  final MetroStation? endMetro;

  /// `/walk?catalog=…` or `/walk?share=…` (site `topWalkHref`).
  String get location => Uri(path: '/walk', queryParameters: {kind == TopWalkKind.catalog ? 'catalog' : 'share': id}).toString();

  String get key => '${kind.name}:$id';

  /// Minutes a duration filter compares: the whole car trip, else the walking time.
  double get minutes => totalMinutes ?? walkingMinutes;

  Map<String, Object?> toJson() => {
        'distanceM': distanceM,
        'endMetro': endMetro?.toJson(),
        'id': id,
        'kind': kind.name,
        'mapPreview': mapPreview?.toJson(),
        'preview': preview == null ? null : [for (final (x, y) in preview!) [x, y]],
        'rank': rank,
        'rating': rating.toJson(),
        'startMetro': startMetro?.toJson(),
        'stopCount': stopCount,
        'title': title,
        if (driving) 'totalMinutes': totalMinutes,
        if (driving) 'travelMode': 'driving',
        'walkingMinutes': walkingMinutes,
      };
}

@immutable
class TopFacets {
  const TopFacets({required this.starts, required this.ends, required this.stations});
  static const empty = TopFacets(starts: [], ends: [], stations: []);
  final List<String> starts;
  final List<String> ends;
  final List<MetroOption> stations;

  Map<String, Object?> toJson() => {'ends': ends, 'starts': starts, 'stations': [for (final s in stations) s.toJson()]};
}

@immutable
class TopWalkPage {
  const TopWalkPage({required this.walks, required this.total, required this.nextOffset, required this.filters});
  final List<TopWalk> walks;
  final int total;
  final int? nextOffset;
  final TopFacets filters;

  Map<String, Object?> toJson() =>
      {'filters': filters.toJson(), 'nextOffset': nextOffset, 'total': total, 'walks': [for (final walk in walks) walk.toJson()]};
}

/// Duration buckets of the server-side filter.
enum TopDuration {
  any(''),
  upTo30('up-to-30'),
  from31To60('31-to-60'),
  from61To90('61-to-90');

  const TopDuration(this.wire);
  final String wire;
}

@immutable
class TopFilters {
  const TopFilters({this.start = '', this.end = '', this.duration = TopDuration.any});
  static const none = TopFilters();
  final String start;
  final String end;
  final TopDuration duration;

  bool get selected => start.isNotEmpty || end.isNotEmpty || duration != TopDuration.any;

  TopFilters copyWith({String? start, String? end, TopDuration? duration}) =>
      TopFilters(start: start ?? this.start, end: end ?? this.end, duration: duration ?? this.duration);

  @override
  bool operator ==(Object other) => other is TopFilters && other.start == start && other.end == end && other.duration == duration;

  @override
  int get hashCode => Object.hash(start, end, duration);
}

final catalogWalkId = RegExp(r'^[a-z0-9][a-z0-9-]{0,127}$');
final walkUuid = RegExp(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$');

double _positive(Object? value) {
  if (value is! num || !value.isFinite || value <= 0) failFormat('Ожидалось положительное число.');
  return value.toDouble();
}

/// Fields every walk card shares (`validateWalkCard`); the caller validates kind and id.
({String title, double walkingMinutes, double distanceM, int stopCount, ReviewSummary rating, bool driving, double? totalMinutes})
    validateWalkCard(Map<String, Object?> item) {
  final title = item['title'];
  if (title is! String || title.trim().isEmpty) failFormat('Нет названия прогулки.');
  final stops = item['stopCount'];
  if (!jsIsSafeInteger(stops) || (stops! as num) < 0) failFormat('Неверное число историй.');
  if (item.containsKey('travelMode') && item['travelMode'] != 'driving') failFormat('Неверный режим поездки.');
  final driving = item['travelMode'] == 'driving';
  final total = driving ? _positive(item['totalMinutes']) : null;
  final rating = ReviewSummary.fromJson(item['rating']);
  return (
    title: title,
    walkingMinutes: _positive(item['walkingMinutes']),
    distanceM: _positive(item['distanceM']),
    stopCount: (stops as num).toInt(),
    rating: rating,
    driving: driving,
    totalMinutes: total,
  );
}

List<(double, double)> _points(Object? value, double max) {
  if (value is! List<Object?> || value.length < 2 || value.length > 80) failFormat('Неверная схема маршрута.');
  return [
    for (final point in value)
      if (point is List<Object?> && point.length == 2 && point.every((c) => c is num && c.isFinite && c >= 0 && c <= max))
        ((point[0]! as num).toDouble(), (point[1]! as num).toDouble())
      else
        failFormat('Неверная схема маршрута.'),
  ];
}

MapPreview? _mapPreview(Object? value) {
  if (value == null) return null;
  final map = readMap(value);
  final zoom = map['zoom'], tiles = map['tiles'];
  if (!jsIsSafeInteger(zoom) || (zoom! as num) < 0 || (zoom as num) > 16 || tiles is! List<Object?> || tiles.isEmpty || tiles.length > 4) {
    failFormat('Неверная карта маршрута.');
  }
  final maximum = math.pow(2, zoom).toInt();
  return MapPreview(
    zoom: zoom.toInt(),
    tiles: [
      for (final raw in tiles)
        () {
          final tile = readMap(raw);
          final x = tile['x'], y = tile['y'], left = tile['left'], top = tile['top'];
          if (left is! num || !left.isFinite || top is! num || !top.isFinite || !jsIsSafeInteger(x) || !jsIsSafeInteger(y) ||
              (x! as num) < 0 || (x as num) >= maximum || (y! as num) < 0 || (y as num) >= maximum || left.abs() > 256 || top.abs() > 256) {
            failFormat('Неверная карта маршрута.');
          }
          return MapTile(x: x.toInt(), y: y.toInt(), left: left.toDouble(), top: top.toDouble());
        }(),
    ],
    points: _points(map['points'], 256),
  );
}

bool _stationName(Object? value) => value is String && value.trim().isNotEmpty && value.length <= 100;

final _lineId = RegExp(r'^\d{1,3}$');
final _lineColor = RegExp(r'^#[0-9a-fA-F]{6}$');

List<MetroLine> _metroLines(Map<String, Object?> owner) {
  if (!owner.containsKey('lines')) return const [];
  final value = owner['lines'];
  if (value is! List<Object?> || value.length > 8) failFormat('Неверные линии метро.');
  return [
    for (final raw in value)
      () {
        final line = readMap(raw);
        final id = line['id'], name = line['name'], color = line['color'];
        if (id is! String || !_lineId.hasMatch(id) || name is! String || name.trim().isEmpty || name.length > 100 || color is! String ||
            !_lineColor.hasMatch(color)) {
          failFormat('Неверная линия метро.');
        }
        return MetroLine(id: id, name: name, color: color);
      }(),
  ];
}

MetroStation? _metro(Object? value) {
  if (value == null) return null;
  final station = readMap(value);
  final distance = station['distanceM'];
  if (!_stationName(station['name']) || !jsIsSafeInteger(distance) || (distance! as num) < 0 || (distance as num) > 1500) {
    failFormat('Неверная станция метро.');
  }
  return MetroStation(name: station['name']! as String, distanceM: distance.toInt(), lines: _metroLines(station));
}

TopWalk _topWalk(Object? raw, int index) {
  final item = readMap(raw);
  final kind = switch (item['kind']) {
    'catalog' => TopWalkKind.catalog,
    'shared' => TopWalkKind.shared,
    _ => failFormat('Неверный вид прогулки.'),
  };
  final id = item['id'];
  if (id is! String || !(kind == TopWalkKind.catalog ? catalogWalkId : walkUuid).hasMatch(id)) failFormat('Неверный идентификатор прогулки.');
  final rank = item['rank'] ?? index + 1;
  if (!jsIsSafeInteger(rank) || (rank as num) < 1) failFormat('Неверное место в топе.');
  final card = validateWalkCard(item);
  return TopWalk(
    kind: kind,
    id: id,
    title: card.title,
    driving: card.driving,
    totalMinutes: card.totalMinutes,
    walkingMinutes: card.walkingMinutes,
    distanceM: card.distanceM,
    stopCount: card.stopCount,
    rating: card.rating,
    rank: rank.toInt(),
    preview: item['preview'] == null ? null : _points(item['preview'], 100),
    mapPreview: _mapPreview(item['mapPreview']),
    startMetro: _metro(item['startMetro']),
    endMetro: _metro(item['endMetro']),
  );
}

List<String> _stationOptions(Object? value) {
  if (value is! List<Object?> || value.length > 1000 || !value.every(_stationName)) failFormat('Неверный список станций.');
  return [for (final name in value) name! as String];
}

/// Line colors of the filter options; a server without them yields the stations of the walks.
List<MetroOption> _stationLines(Map<String, Object?> filters, List<TopWalk> walks) {
  if (!filters.containsKey('stations')) {
    final known = <String, List<MetroLine>>{};
    for (final station in walks.expand((walk) => [walk.startMetro, walk.endMetro]).nonNulls) {
      known[station.name] = station.lines;
    }
    return [for (final MapEntry(:key, :value) in known.entries) MetroOption(name: key, lines: value)];
  }
  final value = filters['stations'];
  if (value is! List<Object?> || value.length > 2000) failFormat('Неверный список станций.');
  return [
    for (final raw in value)
      () {
        final station = readMap(raw);
        final circle = station['insideCircle'];
        if (!_stationName(station['name']) || (station.containsKey('insideCircle') && circle is! bool)) failFormat('Неверный список станций.');
        return MetroOption(name: station['name']! as String, lines: _metroLines(station), insideCircle: circle == true);
      }(),
  ];
}

/// `validateTopWalkPage` of the site.
TopWalkPage validateTopWalkPage(Object? json) {
  final page = readMap(json);
  final rawWalks = page['walks'];
  if (rawWalks is! List<Object?> || rawWalks.length > 20) failFormat('Ожидался список из 20 прогулок.');
  final walks = [for (var i = 0; i < rawWalks.length; i++) _topWalk(rawWalks[i], i)];
  final total = page['total'] ?? walks.length;
  final nextOffset = page['nextOffset'];
  if (!jsIsSafeInteger(total) || (total as num) < walks.length || total > 1000000 ||
      (nextOffset != null && (!jsIsSafeInteger(nextOffset) || (nextOffset as num) < 1 || nextOffset > total))) {
    failFormat('Неверная страница прогулок.');
  }
  final Map<String, Object?> filters;
  if (!page.containsKey('filters')) {
    filters = {
      'starts': [...{for (final walk in walks) ?walk.startMetro?.name}],
      'ends': [...{for (final walk in walks) ?walk.endMetro?.name}],
    };
  } else {
    filters = readMap(page['filters']);
  }
  return TopWalkPage(
    walks: walks,
    total: total.toInt(),
    nextOffset: (nextOffset as num?)?.toInt(),
    filters: TopFacets(starts: _stationOptions(filters['starts']), ends: _stationOptions(filters['ends']), stations: _stationLines(filters, walks)),
  );
}

/// A further page must move forward, or infinite loading would repeat it forever.
TopWalkPage Function(Object?) validateTopWalkPageAfter(int offset) => (json) {
      final page = validateTopWalkPage(json);
      if (page.nextOffset != null && page.nextOffset! <= offset) failFormat('Страница прогулок не продвинулась.');
      return page;
    };

/// Query of `GET /api/top-walks` (site `topWalksUrl`): Moscow, the server's default, is not named.
Map<String, String> topWalksQuery(int offset, TopFilters filters, String city) => {
      if (city != 'moscow') 'city': city,
      if (offset != 0) 'offset': '$offset',
      if (filters.start.isNotEmpty) 'start': filters.start,
      if (filters.end.isNotEmpty) 'end': filters.end,
      if (filters.duration != TopDuration.any) 'duration': filters.duration.wire,
    };

/// Merges a further page: walks already shown (by kind and id) are not repeated.
List<TopWalk> appendTopWalks(List<TopWalk> current, List<TopWalk> next) {
  final seen = {for (final walk in current) walk.key};
  return [...current, ...next.where((walk) => !seen.contains(walk.key))];
}

/// The options of one metro picker: «Внутри Кольцевой» leads when one of the stations lies inside
/// the Circle line, and stays while it is the chosen value. [label] and [hint] are already translated.
List<MetroOption> metroOptions(List<String> names, String value, List<MetroOption> stations, {required String label, required String hint}) {
  final known = {for (final station in stations) station.name: station};
  final options = [for (final name in names) known[name] ?? MetroOption(name: name, lines: const [])];
  final circle = MetroOption(name: insideCircle, lines: const [circleLine], label: label, hint: hint);
  return options.any((option) => option.insideCircle) || value == insideCircle ? [circle, ...options] : options;
}

String _searchKey(String text) => text.toLowerCase().replaceAll('ё', 'е').replaceAll(RegExp(r'\s+'), ' ').trim();

/// Stations whose name or line matches the query, ignoring case and ё; name prefixes come first.
List<MetroOption> searchMetroOptions(List<MetroOption> options, String query) {
  final key = _searchKey(query);
  if (key.isEmpty) return options;
  final scored = <(MetroOption, int)>[];
  for (final option in options) {
    final name = _searchKey(option.label ?? option.name);
    final hint = option.hint;
    final score = name.startsWith(key)
        ? 0
        : name.split(RegExp(r'[\s-]')).any((word) => word.startsWith(key))
            ? 1
            : name.contains(key)
                ? 2
                : option.lines.any((line) => _searchKey(line.name).contains(key)) || (hint != null && _searchKey(hint).contains(key))
                    ? 3
                    : -1;
    if (score >= 0) scored.add((option, score));
  }
  // List.sort is not stable; a merge by score keeps the server order inside each score, as Array.sort does.
  return [for (var score = 0; score <= 3; score++) ...scored.where((item) => item.$2 == score).map((item) => item.$1)];
}

/// White or black metro letter chosen for WCAG text contrast on the line color.
bool metroTextIsBlack(String hex) {
  double channel(int position) {
    final value = int.parse(hex.substring(position, position + 2), radix: 16) / 255;
    return value <= 0.04045 ? value / 12.92 : math.pow((value + 0.055) / 1.055, 2.4).toDouble();
  }

  return channel(1) * 0.2126 + channel(3) * 0.7152 + channel(5) * 0.0722 > 0.179;
}

/// «6 историй» for the card meta; English and Chinese use the dictionary forms.
String storyCountLabel(int count, AppLocale locale, String Function(String source, Map<String, Object> values) t) {
  if (locale == AppLocale.en) return count == 1 ? t('{count} история', {'count': count}) : t('{count} историй', {'count': count});
  if (locale == AppLocale.zh) return t('{count} историй', {'count': count});
  return '$count ${switch (ruPlural(count)) {
    RuPlural.one => 'история',
    RuPlural.few => 'истории',
    RuPlural.many => 'историй',
  }}';
}

/// «45 мин · 3,2 км · 6 историй».
String formatTopWalkMeta(TopWalk walk, AppLocale locale, String Function(String source, Map<String, Object> values) t) {
  final values = <String, Object>{
    'minutes': jsRound(walk.minutes),
    'distance': formatFixed(walk.distanceM / 1000, locale),
    'stories': storyCountLabel(walk.stopCount, locale, t),
  };
  return walk.driving ? t('На машине · {minutes} мин · {distance} км · {stories}', values) : t('{minutes} мин · {distance} км · {stories}', values);
}
