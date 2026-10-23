/// Walks passing near a point, `GET /api/walks/nearby` (port of the server part of
/// `src/features/walks/nearby-model.ts`; the browser-local walks of the site have no server answer).
library;

import 'package:dio/dio.dart' show CancelToken;
import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import '../../core/i18n/translations.dart';
import '../../walk_engine/distance.dart';
import '../../walk_engine/json_read.dart';
import '../reviews/review_model.dart';
import '../walks/format.dart';
import '../walks/top_model.dart';

const nearbyWalksPath = '/api/walks/nearby';

/// Must match NEARBY_RADIUS_M in backend/walk-nearby.mjs.
const nearbyWalkRadiusM = 500;

enum NearbyWalkKind { catalog, shared, own }

/// A walk that passes near the point. New responses describe the remaining route from [entryStopId];
/// fields omitted by an older backend remain valid.
@immutable
class NearbyWalk {
  const NearbyWalk({
    required this.kind,
    required this.id,
    required this.title,
    required this.walkingMinutes,
    required this.distanceM,
    required this.stopCount,
    required this.rating,
    required this.startDistanceM,
    required this.finish,
    this.driving = false,
    this.totalMinutes,
    this.entryStopId,
    this.audioMinutes,
    this.audioComplete,
  });

  final NearbyWalkKind kind;
  final String id;
  final String title;
  final bool driving;
  final double? totalMinutes;
  final double walkingMinutes;
  final double distanceM;
  final int stopCount;
  final ReviewSummary rating;
  final int startDistanceM;

  /// Address where an open walk ends; null for a loop back to the start.
  final String? finish;
  final String? entryStopId;
  final int? audioMinutes;
  final bool? audioComplete;

  /// The user's own account walk («Ваша»).
  bool get isOwn => kind == NearbyWalkKind.own;

  String get key => '${kind.name}:$id';

  /// `/walk?catalog=…|share=…|id=…[&fromStop=…]` (site `nearbyWalkHref`).
  String get location => Uri(path: '/walk', queryParameters: {
        switch (kind) {
          NearbyWalkKind.catalog => 'catalog',
          NearbyWalkKind.shared => 'share',
          NearbyWalkKind.own => 'id',
        }: id,
        'fromStop': ?entryStopId,
      }).toString();

  Map<String, Object?> toJson() => {
        if (audioComplete != null) 'audioComplete': audioComplete,
        if (audioMinutes != null) 'audioMinutes': audioMinutes,
        'distanceM': distanceM,
        if (entryStopId != null) 'entryStopId': entryStopId,
        'finish': finish,
        'id': id,
        'kind': kind.name,
        'rating': rating.toJson(),
        'startDistanceM': startDistanceM,
        'stopCount': stopCount,
        'title': title,
        if (driving) 'totalMinutes': totalMinutes,
        if (driving) 'travelMode': 'driving',
        'walkingMinutes': walkingMinutes,
      };
}

final _accountId = RegExp(walkUuid.pattern, caseSensitive: false);

NearbyWalk _validateNearbyWalk(Object? raw) {
  final item = readMap(raw);
  final kind = switch (item['kind']) {
    'catalog' => NearbyWalkKind.catalog,
    'shared' => NearbyWalkKind.shared,
    'own' => NearbyWalkKind.own,
    // `local` walks exist only on the device, so the server never sends them.
    _ => failFormat('Неверный вид прогулки.'),
  };
  final id = item['id'];
  final idPattern = switch (kind) {
    NearbyWalkKind.catalog => catalogWalkId,
    NearbyWalkKind.shared => walkUuid,
    NearbyWalkKind.own => _accountId,
  };
  if (id is! String || !idPattern.hasMatch(id)) failFormat('Неверный идентификатор прогулки.');
  final start = item['startDistanceM'];
  if (!jsIsSafeInteger(start) || (start! as num) < 0) failFormat('Неверное расстояние до старта.');
  final finish = item['finish'];
  if (finish != null && (finish is! String || finish.trim().isEmpty || finish.length > 180)) failFormat('Неверный адрес финиша.');
  final entry = item['entryStopId'];
  if (item.containsKey('entryStopId') && (entry is! String || !(_accountId.hasMatch(entry) || catalogWalkId.hasMatch(entry)))) {
    failFormat('Неверная точка начала прогулки.');
  }
  final audioMinutes = item['audioMinutes'];
  final hasMinutes = item.containsKey('audioMinutes');
  if (hasMinutes && (!jsIsSafeInteger(audioMinutes) || (audioMinutes! as num) < 0)) failFormat('Неверная длительность озвучки.');
  final audioComplete = item['audioComplete'];
  final hasComplete = item.containsKey('audioComplete');
  if (hasComplete && audioComplete is! bool) failFormat('Неверный статус озвучки.');
  if (hasMinutes != hasComplete) failFormat('Неполные данные об озвучке.');
  final card = validateWalkCard(item);
  return NearbyWalk(
    kind: kind,
    id: id,
    title: card.title,
    driving: card.driving,
    totalMinutes: card.totalMinutes,
    walkingMinutes: card.walkingMinutes,
    distanceM: card.distanceM,
    stopCount: card.stopCount,
    rating: card.rating,
    startDistanceM: (start as num).toInt(),
    finish: finish as String?,
    entryStopId: entry as String?,
    audioMinutes: (audioMinutes as num?)?.toInt(),
    audioComplete: audioComplete as bool?,
  );
}

List<NearbyWalk> validateNearbyWalks(Object? value) {
  final walks = readMap(value)['walks'];
  if (walks is! List<Object?>) failFormat('Ожидался список прогулок.');
  return [for (final walk in walks) _validateNearbyWalk(walk)];
}

Future<List<NearbyWalk>> fetchNearbyWalks(ApiClient api, GeoPoint point, {CancelToken? cancel}) => api.get(
      nearbyWalksPath,
      validateNearbyWalks,
      query: {'lat': point.lat.toStringAsFixed(6), 'lon': point.lon.toStringAsFixed(6)},
      cancel: cancel,
    );

/// «Осталось 2,1 км · 6 точек · 12 мин озвучки»: the details needed before starting a nearby walk.
String formatNearbyWalkMeta(NearbyWalk walk, AppLocale locale, String Function(String source, Map<String, Object> values) t) {
  final km = formatFixed(walk.distanceM / 1000, locale);
  final points = locale == AppLocale.ru
      ? '${walk.stopCount} ${switch (ruPlural(walk.stopCount)) {
          RuPlural.one => 'точка',
          RuPlural.few => 'точки',
          RuPlural.many => 'точек',
        }}'
      : t('{count} точек', {'count': walk.stopCount});
  final minutes = walk.audioMinutes;
  final audio = minutes == null
      ? t('нет данных об озвучке', const {})
      : minutes == 0
          ? t('Озвучка пока не готова', const {})
          : walk.audioComplete == false
              ? t('{minutes} мин готовой озвучки', {'minutes': minutes})
              : t('{minutes} мин озвучки', {'minutes': minutes});
  return t('Осталось {km} км · {points} · {audio}', {'km': km, 'points': points, 'audio': audio});
}
