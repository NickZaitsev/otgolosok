/// Position fixes from the walk service plugin's one-shot requests (port of the two requests of the
/// site's `locateOnce`): a quick coarse fix (Wi-Fi, cell towers, a fix up to a minute old) and, in
/// parallel, a precise GPS fix. Needs no walk session and no map location engine.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:walk_service/walk_service.dart';

import 'locate.dart';

/// Error codes and details of `currentLocation` (see `pigeons/walk_service_api.dart`).
const _permissionDeniedCode = 'permission_denied';
const _locationUnavailableCode = 'location_unavailable';
const _locationDisabledDetail = 'location_disabled';

class WalkServiceFixSource implements FixSource {
  WalkServiceFixSource({
    WalkServiceHostApi? api,
    this.coarseMaxAge = const Duration(minutes: 1),
    this.coarseTimeout = const Duration(seconds: 10),
    this.preciseTimeout = const Duration(seconds: 20),
  }) : _api = api ?? WalkServiceHostApi();

  final WalkServiceHostApi _api;

  /// The oldest cached fix the coarse request may return (site: `maximumAge: 60_000`).
  final Duration coarseMaxAge;
  final Duration coarseTimeout;
  final Duration preciseTimeout;

  @override
  FixSubscription listen(void Function(LocatedFix fix) onFix, void Function(LocateError error) onError) {
    final run = _Run(_api, onFix, onError);
    run.request(LocationPriority.coarse, coarseMaxAge, coarseTimeout);
    run.request(LocationPriority.precise, Duration.zero, preciseTimeout);
    return run;
  }
}

class _Run implements FixSubscription {
  _Run(this._api, this._onFix, this._onError);

  final WalkServiceHostApi _api;
  final void Function(LocatedFix fix) _onFix;
  final void Function(LocateError error) _onError;

  var _closed = false;
  var _pending = 0;
  LocateError? _failure;

  void request(LocationPriority priority, Duration maxAge, Duration timeout) {
    _pending++;
    unawaited(_request(priority, maxAge, timeout));
  }

  Future<void> _request(LocationPriority priority, Duration maxAge, Duration timeout) async {
    LocateError? failure;
    try {
      final fix = await _api.currentLocation(priority, maxAge.inMilliseconds, timeout.inMilliseconds);
      if (_closed) return;
      final located = fix == null ? null : _located(fix);
      if (located != null) {
        _onFix(located);
      } else {
        failure = LocateError.timeout;
      }
    } on PlatformException catch (error) {
      if (_closed) return;
      if (error.code == _permissionDeniedCode) {
        _close();
        _onError(LocateError.permissionDenied);
        return;
      }
      failure = error.code == _locationUnavailableCode && error.details == _locationDisabledDetail
          ? LocateError.servicesDisabled
          : LocateError.positionUnavailable;
      if (failure != LocateError.servicesDisabled) debugPrint('currentLocation($priority) failed: ${error.code}');
    } catch (error) {
      if (_closed) return;
      failure = LocateError.positionUnavailable;
      debugPrint('currentLocation($priority) failed: $error');
    }
    if (_closed) return;
    // A definite failure outranks «no fix in time», like the site's position-unavailable over timeout.
    if (failure != null && (_failure == null || _failure == LocateError.timeout)) _failure = failure;
    _pending--;
    if (_pending > 0) return;
    // Both requests are over: nothing left to refine with.
    _closed = true;
    _onError(_failure ?? LocateError.timeout);
  }

  static LocatedFix? _located(Fix fix) {
    if (!fix.lat.isFinite || !fix.lon.isFinite || fix.lat.abs() > 90 || fix.lon.abs() > 180) return null;
    return LocatedFix(
      lat: fix.lat,
      lon: fix.lon,
      accuracyM: fix.accuracyM.isFinite && fix.accuracyM >= 0 ? fix.accuracyM : double.infinity,
      timestampMs: fix.timestampMs,
    );
  }

  void _close() {
    _closed = true;
    if (_pending == 0) return;
    // Stops GPS that would otherwise keep searching until its own timeout.
    unawaited(_api.cancelCurrentLocation().catchError((Object error) => debugPrint('cancelCurrentLocation failed: $error')));
  }

  @override
  void cancel() {
    if (!_closed) _close();
  }
}
