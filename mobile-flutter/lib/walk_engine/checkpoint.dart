// Port of src/lib/audio/playback-progress.ts and of the checkpoint serializer
// of src/features/tour/use-playback-progress.ts.
import 'dart:convert';
import 'dart:math' as math;

import 'js_json.dart';
import 'walk_direction.dart';

/// A recording a checkpoint may point into.
class PlaybackChapter {
  const PlaybackChapter({required this.id, required this.audioUrl, required this.durationSec});

  final String id;
  final String audioUrl;
  final double durationSec;
}

/// Where listening stopped: valid only for the same chapter and recording.
class PlaybackCheckpoint {
  const PlaybackCheckpoint({
    required this.routeId,
    required this.chapterId,
    required this.audioUrl,
    required this.positionSec,
  });

  int get version => 1;
  final String routeId;
  final String chapterId;
  final String audioUrl;
  final double positionSec;

  PlaybackCheckpoint at(double positionSec) => PlaybackCheckpoint(
    routeId: routeId,
    chapterId: chapterId,
    audioUrl: audioUrl,
    positionSec: positionSec,
  );

  Map<String, Object?> toJson() => {
    'version': version,
    'routeId': routeId,
    'chapterId': chapterId,
    'audioUrl': audioUrl,
    'positionSec': positionSec,
  };

  /// The stored text, as the site's `JSON.stringify(checkpoint)`.
  String serialize() => jsJsonStringify(toJson());

  @override
  bool operator ==(Object other) =>
      other is PlaybackCheckpoint &&
      other.routeId == routeId &&
      other.chapterId == chapterId &&
      other.audioUrl == audioUrl &&
      other.positionSec == positionSec;

  @override
  int get hashCode => Object.hash(routeId, chapterId, audioUrl, positionSec);

  @override
  String toString() => 'PlaybackCheckpoint(${serialize()})';
}

enum PlaybackLocale { ru, en, zh }

String playbackStorageKey(String routeId, [PlaybackLocale locale = PlaybackLocale.ru]) =>
    'otgolosok:playback:$routeId${locale == PlaybackLocale.ru ? '' : ':${locale.name}'}';

/// The key a walk in [direction] keeps its checkpoint under (usePlaybackProgress).
String walkCheckpointKey(String routeId, PlaybackLocale locale, WalkDirection direction) =>
    playbackStorageKey(routeId, locale) + (direction == WalkDirection.reverse ? ':reverse' : '');

/// Only a checkpoint for the same recording may restore an audio offset.
PlaybackCheckpoint? parsePlaybackCheckpoint(
  String? raw,
  String routeId,
  List<PlaybackChapter> chapters,
) {
  if (raw == null || raw.isEmpty || raw.length > 2048) return null;
  final Object? saved;
  try {
    saved = jsonDecode(raw);
  } on FormatException {
    return null;
  }
  if (saved is! Map<String, Object?>) return null;
  final position = saved['positionSec'];
  if (saved['version'] != 1 ||
      saved['routeId'] != routeId ||
      position is! num ||
      !position.isFinite ||
      position < 0) {
    return null;
  }
  PlaybackChapter? chapter;
  for (final item in chapters) {
    if (item.id == saved['chapterId'] && item.audioUrl == saved['audioUrl']) {
      chapter = item;
      break;
    }
  }
  if (chapter == null || !chapter.durationSec.isFinite || chapter.durationSec <= 0) {
    return null;
  }
  return PlaybackCheckpoint(
    routeId: routeId,
    chapterId: chapter.id,
    audioUrl: chapter.audioUrl,
    positionSec: math.min(position.toDouble(), chapter.durationSec),
  );
}

/// `m:ss` of a playback position; non-finite and negative values show 0:00.
String formatPlaybackTime(double seconds) {
  final whole = seconds.isFinite ? math.max(0, seconds.floor()) : 0;
  return '${whole ~/ 60}:${(whole % 60).toString().padLeft(2, '0')}';
}
