// Platform contract of the walk service: Dart runs the walk, the native side keeps it alive
// with the screen off (foreground service, location, player, lock-screen card).
// Regenerate: `dart run pigeon --input pigeons/walk_service_api.dart` from packages/walk_service.
import 'package:pigeon/pigeon.dart';

@ConfigurePigeon(PigeonOptions(
  dartOut: 'lib/src/walk_service_api.g.dart',
  dartOptions: DartOptions(),
  kotlinOut: 'android/src/main/kotlin/online/otgolosok/walk_service/WalkServiceApi.g.kt',
  kotlinOptions: KotlinOptions(package: 'online.otgolosok.walk_service', errorClassName: 'WalkServiceError'),
  dartPackageName: 'walk_service',
))

/// `walk`: a walk with GPS arrivals; `listen`: a single story or a car stop, no tracking.
enum SessionKind { walk, listen }

/// Localized texts the native side shows without asking Dart.
class NotificationTexts {
  NotificationTexts({
    required this.channelName,
    required this.liveChannelName,
    required this.stopAction,
    required this.nextAction,
    required this.backAction,
    required this.partOf,
    required this.toStop,
    required this.distanceMeters,
  });

  /// Channel of the media card, e.g. «Прогулка».
  String channelName;

  /// Channel of the Live Update, «Путь к точке».
  String liveChannelName;
  String stopAction;
  String nextAction;
  String backAction;

  /// «Часть {current} из {total}».
  String partOf;

  /// «До «{stop}»».
  String toStop;

  /// «{distance} м».
  String distanceMeters;
}

class SessionConfig {
  SessionConfig({
    required this.kind,
    required this.walkTitle,
    required this.texts,
    required this.tracking,
    required this.locationIntervalMs,
    required this.minDistanceM,
    required this.contentRoute,
  });

  SessionKind kind;
  String walkTitle;
  NotificationTexts texts;
  bool tracking;
  int locationIntervalMs;
  double minDistanceM;

  /// App route the notification opens, e.g. `/walk?share=…`.
  String contentRoute;
}

class Track {
  Track({
    required this.id,
    required this.uri,
    required this.title,
    required this.subtitle,
    required this.album,
    this.artworkUri,
    required this.startPositionMs,
    required this.rate,
    required this.autoplay,
  });

  String id;

  /// `https://…` (streamed through the disk cache) or `file://…` (offline copy).
  String uri;
  String title;
  String subtitle;
  String album;
  String? artworkUri;
  int startPositionMs;
  double rate;

  /// false: load and stay paused (resuming a checkpoint without sound).
  bool autoplay;
}

enum CardStage { approach, playing, paused, finished }

class CardState {
  CardState({
    required this.stage,
    required this.chapterIndex,
    required this.chapterCount,
    required this.chapterTitle,
    this.nextStopTitle,
    this.distanceM,
  });

  CardStage stage;
  int chapterIndex;
  int chapterCount;
  String chapterTitle;
  String? nextStopTitle;
  double? distanceM;
}

enum PermissionStatus { granted, denied, permanentlyDenied }

class PermissionState {
  PermissionState({required this.location, required this.notifications, required this.preciseLocation});

  PermissionStatus location;
  PermissionStatus notifications;

  /// false when the user granted only approximate location.
  bool preciseLocation;
}

class Fix {
  Fix({required this.lat, required this.lon, required this.accuracyM, required this.timestampMs, required this.provider});

  double lat;
  double lon;
  double accuracyM;
  int timestampMs;

  /// `fused`, `gps` or `network`.
  String provider;
}

enum LocationStatus { active, unavailable, permissionDenied, error }

/// A one-shot fix: `coarse` is quick (Wi-Fi, cell towers, a recent cached fix), `precise` waits for GPS.
enum LocationPriority { coarse, precise }

enum PlaybackState { idle, buffering, playing, paused, ended, error }

class PlayerState {
  PlayerState({
    this.trackId,
    required this.state,
    required this.positionMs,
    required this.durationMs,
    this.errorCode,
  });

  String? trackId;
  PlaybackState state;
  int positionMs;
  int durationMs;
  String? errorCode;
}

enum MediaCommandKind { play, pause, next, previous, seekBy, seekTo, stop }

class MediaCommand {
  MediaCommand({required this.kind, this.ms});

  MediaCommandKind kind;

  /// Offset for seekBy, position for seekTo.
  int? ms;
}

/// Errors: FlutterError codes `fgs_not_allowed`, `permission_denied`, `location_unavailable`,
/// `player_error`, `invalid_argument`.
@HostApi()
abstract class WalkServiceHostApi {
  /// Must be called from a visible activity (a tap): Android 14+ refuses a background start.
  /// Completes once the service is in the foreground (async on the host: the refusal arrives
  /// from the service a moment after the start request).
  @async
  void startSession(SessionConfig config);
  void stopSession();
  bool isSessionActive();
  void play(Track track);
  void pause();
  void resume();
  void seekTo(int ms);
  void seekBy(int ms);
  void setRate(double rate);
  void prefetch(String uri);
  void updateCard(CardState state);
  PermissionState permissionState();
  @async
  PermissionState requestPermissions();
  void openAppSettings();

  /// Fine and coarse location only, without the notification permission: a tap on «Моё
  /// местоположение» needs nothing else. Without an attached activity returns the current state.
  @async
  PermissionState requestLocationPermission();

  /// The device-wide location switch (system settings → Location).
  bool locationServicesEnabled();

  /// Opens the system location settings, or all settings when the device has no such screen.
  void openLocationSettings();

  /// One fix for a visible screen, without the walk service: the fused provider when Google Play
  /// services are usable, otherwise LocationManager. A cached fix up to [maxAgeMs] old is returned at
  /// once. Null when no fix arrived within [timeoutMs] (1…60000) or the request was cancelled.
  /// Errors: `permission_denied` without the location permission, `location_unavailable` when
  /// location is switched off on the device, `invalid_argument` for bad limits.
  @async
  Fix? currentLocation(LocationPriority priority, int maxAgeMs, int timeoutMs);

  /// Completes every pending [currentLocation] with null and stops its provider.
  void cancelCurrentLocation();
}

@FlutterApi()
abstract class WalkServiceFlutterApi {
  void onFix(Fix fix);
  void onLocationStatus(LocationStatus status, String? code);
  void onPlayer(PlayerState state);
  void onMediaCommand(MediaCommand command);
  void onSessionStopped();
}
