import 'package:flutter/services.dart';

/// Error codes of the walk service contract (`pigeons/walk_service_api.dart`).
abstract final class WalkServiceErrorCodes {
  static const fgsNotAllowed = 'fgs_not_allowed';
  static const permissionDenied = 'permission_denied';
  static const locationUnavailable = 'location_unavailable';
  static const playerError = 'player_error';
  static const invalidArgument = 'invalid_argument';
}

/// Russian source texts (dictionary keys) for failures of the walk service; the UI translates
/// them with `context.t` and always offers a retry next to them.
abstract final class WalkServiceMessages {
  static const startRefused =
      'Android не разрешил запустить прогулку. Откройте приложение и нажмите кнопку ещё раз.';
  static const permissionDenied =
      'Нет доступа к геолокации. Прогулка пойдёт без неё: остановки переключаются кнопкой «Дальше».';
  static const locationUnavailable =
      'Геолокация на телефоне выключена. Включите её или переключайте остановки кнопкой «Дальше».';
  static const playback = 'Не удалось воспроизвести аудио. Попробуйте запустить его ещё раз.';
  static const generic = 'Не удалось запустить прогулку. Попробуйте ещё раз.';
  static const storyGeneric = 'Не удалось включить запись. Проверьте соединение и попробуйте ещё раз.';

  static const all = [startRefused, permissionDenied, locationUnavailable, playback, generic, storyGeneric];
}

/// The user-facing message for a failed host call. [MissingPluginException] (no native side,
/// e.g. a desktop run) and unexpected errors fall back to [fallback].
String walkServiceMessage(Object error, {String fallback = WalkServiceMessages.generic}) {
  if (error is! PlatformException) return fallback;
  return switch (error.code) {
    WalkServiceErrorCodes.fgsNotAllowed => WalkServiceMessages.startRefused,
    WalkServiceErrorCodes.permissionDenied => WalkServiceMessages.permissionDenied,
    WalkServiceErrorCodes.locationUnavailable => WalkServiceMessages.locationUnavailable,
    WalkServiceErrorCodes.playerError => WalkServiceMessages.playback,
    _ => fallback,
  };
}
