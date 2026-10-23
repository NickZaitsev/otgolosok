/// One-shot «где я» (port of `src/lib/position/locate.ts`): the first fix is shown at once, then refined
/// for up to [LocateConfig.refine] or until it is as good as [LocateConfig.goodAccuracyM]. The deadline
/// starts only after permission is granted, so time spent on the system dialog never counts.
library;

import 'dart:async';

/// A position as the map and the nearby search use it.
class LocatedFix {
  const LocatedFix({required this.lat, required this.lon, required this.accuracyM, required this.timestampMs});

  final double lat;
  final double lon;

  /// Radius of uncertainty; [double.infinity] when the platform did not report one.
  final double accuracyM;
  final int timestampMs;

  @override
  bool operator ==(Object other) =>
      other is LocatedFix && other.lat == lat && other.lon == lon && other.accuracyM == accuracyM && other.timestampMs == timestampMs;

  @override
  int get hashCode => Object.hash(lat, lon, accuracyM, timestampMs);

  @override
  String toString() => 'LocatedFix($lat, $lon ±$accuracyM)';
}

/// Why no position could be given (`LocateErrorCode` of the site, plus [servicesDisabled]).
enum LocateError {
  unsupported,
  permissionDenied,
  positionUnavailable,

  /// Location is switched off on the device: the system location settings can fix it.
  servicesDisabled,
  timeout,
}

/// The Russian source text of an error, translated by the UI like any other string.
String describeLocateError(LocateError error) => switch (error) {
      LocateError.unsupported => 'Геолокация недоступна на этом устройстве.',
      LocateError.permissionDenied => 'Нет доступа к геолокации.',
      LocateError.positionUnavailable || LocateError.servicesDisabled =>
        'Устройство не смогло определить положение. Проверьте, что геолокация включена в настройках устройства.',
      LocateError.timeout => 'Не удалось вовремя определить положение.',
    };

/// An improving fix (`final == false`) or the single final event: the best fix or an error.
sealed class LocateUpdate {
  const LocateUpdate();
}

class LocateFixUpdate extends LocateUpdate {
  const LocateFixUpdate(this.fix, {required this.isFinal});

  final LocatedFix fix;
  final bool isFinal;
}

class LocateErrorUpdate extends LocateUpdate {
  const LocateErrorUpdate(this.error);

  final LocateError error;
}

/// The state of the location permission as the app can act on it.
enum LocationAccess {
  granted,

  /// Not granted yet, or refused once: the system dialog can still be shown.
  denied,

  /// Refused for good: only the app settings can change it.
  blocked,

  /// The device or build has no location service at all.
  unsupported,
}

/// Reads and requests the location permission.
abstract interface class LocationPermissions {
  Future<LocationAccess> check();

  /// Shows the system dialog when it can; returns the state after it.
  Future<LocationAccess> request();

  Future<void> openSettings();
}

/// The device-wide location switch.
abstract interface class LocationServices {
  Future<bool> enabled();

  /// Opens the system location settings.
  Future<void> openSettings();
}

/// A running position request; [cancel] stops the platform engine.
abstract interface class FixSubscription {
  void cancel();
}

/// Delivers fixes while subscribed: a recent last-known fix first when the platform has one, then
/// improving fixes. [onError] is terminal for the subscription: either a failure, or, after fixes,
/// the sign that the source has nothing more to refine with.
abstract interface class FixSource {
  FixSubscription listen(void Function(LocatedFix fix) onFix, void Function(LocateError error) onError);
}

typedef StartTimer = Timer Function(Duration duration, void Function() callback);

class LocateConfig {
  const LocateConfig({
    this.goodAccuracyM = 30,
    this.refine = const Duration(seconds: 6),
    this.deadline = const Duration(seconds: 20),
  });

  /// Accuracy at which refining stops.
  final double goodAccuracyM;

  /// How long to keep refining after the first fix.
  final Duration refine;

  /// The longest wait after permission was granted.
  final Duration deadline;
}

/// Runs one locate request at a time per call of [locate].
class Locator {
  Locator({required this.permissions, required this.source, this.services, this.config = const LocateConfig(), StartTimer? startTimer})
      : _startTimer = startTimer ?? Timer.new;

  final LocationPermissions permissions;
  final FixSource source;

  /// When set, a device with location switched off fails at once with [LocateError.servicesDisabled]
  /// instead of waiting for the deadline.
  final LocationServices? services;
  final LocateConfig config;
  final StartTimer _startTimer;

  /// Sends improving fixes and exactly one final update to [listener]; returns a cancel function
  /// after which nothing more is sent.
  void Function() locate(void Function(LocateUpdate update) listener) {
    final run = _LocateRun(this, listener);
    unawaited(run.start());
    return run.cancel;
  }
}

class _LocateRun {
  _LocateRun(this.locator, this.listener);

  final Locator locator;
  final void Function(LocateUpdate update) listener;

  bool _done = false;
  LocatedFix? _best;
  FixSubscription? _subscription;
  Timer? _refineTimer;
  Timer? _deadlineTimer;

  Future<void> start() async {
    LocationAccess access;
    try {
      access = await locator.permissions.check();
      if (_done) return;
      if (access == LocationAccess.denied) {
        access = await locator.permissions.request();
        if (_done) return;
      }
    } catch (_) {
      // A platform channel that is missing or failed: the device cannot locate through it.
      access = LocationAccess.unsupported;
    }
    switch (access) {
      case LocationAccess.granted:
        break;
      case LocationAccess.unsupported:
        _finish(const LocateErrorUpdate(LocateError.unsupported));
        return;
      case LocationAccess.denied || LocationAccess.blocked:
        _finish(const LocateErrorUpdate(LocateError.permissionDenied));
        return;
    }
    if (_done) return;
    if (!await _servicesEnabled()) {
      _finish(const LocateErrorUpdate(LocateError.servicesDisabled));
      return;
    }
    if (_done) return;
    _deadlineTimer = locator._startTimer(locator.config.deadline, _settle);
    try {
      final subscription = locator.source.listen(_onFix, _onError);
      if (_done) {
        subscription.cancel();
      } else {
        _subscription = subscription;
      }
    } catch (_) {
      _finish(const LocateErrorUpdate(LocateError.positionUnavailable));
    }
  }

  /// A failed check is not a verdict: the source still reports a switched-off device itself.
  Future<bool> _servicesEnabled() async {
    final services = locator.services;
    if (services == null) return true;
    try {
      return await services.enabled();
    } catch (_) {
      return true;
    }
  }

  void _onFix(LocatedFix fix) {
    if (_done) return;
    final best = _best;
    if (best != null && !(fix.accuracyM < best.accuracyM)) return;
    _best = fix;
    if (fix.accuracyM <= locator.config.goodAccuracyM) {
      _settle();
      return;
    }
    listener(LocateFixUpdate(fix, isFinal: false));
    if (best == null) _refineTimer = locator._startTimer(locator.config.refine, _settle);
  }

  void _onError(LocateError error) {
    if (_done) return;
    if (error == LocateError.permissionDenied) {
      _finish(const LocateErrorUpdate(LocateError.permissionDenied));
      return;
    }
    // Nothing left to refine with: the best fix so far, else this error.
    final best = _best;
    _finish(best != null ? LocateFixUpdate(best, isFinal: true) : LocateErrorUpdate(error));
  }

  void _settle() {
    final best = _best;
    _finish(best != null ? LocateFixUpdate(best, isFinal: true) : const LocateErrorUpdate(LocateError.timeout));
  }

  void _finish(LocateUpdate update) {
    if (_done) return;
    _cleanup();
    listener(update);
  }

  void _cleanup() {
    _done = true;
    _subscription?.cancel();
    _subscription = null;
    _refineTimer?.cancel();
    _deadlineTimer?.cancel();
  }

  void cancel() {
    if (!_done) _cleanup();
  }
}
