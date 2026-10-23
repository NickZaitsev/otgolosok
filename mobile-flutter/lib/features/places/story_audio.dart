/// Playing a place story through the walk service (`SessionConfig.kind = listen`).
///
/// The place card only describes what to play and shows the state; the player feature binds the
/// implementation by overriding [storyAudioControllerProvider], since the walk service has a single
/// Flutter-side handler (`WalkServiceFlutterApi.setUp`) that the player owns.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// One story recording to play in the foreground service with its media notification.
@immutable
class StoryAudioRequest {
  const StoryAudioRequest({
    required this.placeId,
    required this.url,
    required this.title,
    required this.subtitle,
    this.artworkUrl,
    this.durationSec,
  });

  final String placeId;

  /// Absolute URL of the MP3 on the site origin.
  final Uri url;

  /// Shown in the notification: the place title and its address.
  final String title;
  final String subtitle;
  final Uri? artworkUrl;

  /// From the place detail; the service reports the real duration once the file is open.
  final double? durationSec;
}

enum StoryAudioPhase { idle, preparing, playing, paused, failed }

@immutable
class StoryAudioState {
  const StoryAudioState({this.placeId, this.phase = StoryAudioPhase.idle, this.position = Duration.zero, this.duration, this.error});

  /// The place whose story the service holds; null when nothing is loaded.
  final String? placeId;
  final StoryAudioPhase phase;
  final Duration position;
  final Duration? duration;

  /// Russian source text of the failure, translated by the UI.
  final String? error;
}

/// What the place card needs from the story player.
abstract interface class StoryAudioController implements Listenable {
  StoryAudioState get state;

  /// Starts [request] from the beginning, replacing whatever the service played.
  Future<void> play(StoryAudioRequest request);

  Future<void> pause();

  Future<void> resume();
}

/// Null until the player feature binds the walk service; the card then offers no playback.
final storyAudioControllerProvider = Provider<StoryAudioController?>((ref) => null);
