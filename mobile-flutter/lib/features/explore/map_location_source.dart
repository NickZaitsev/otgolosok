/// Position fixes from the map's own location component (MapLibre `myLocationEnabled`), for one locate run.
///
/// The app has no one-shot geolocation plugin: the map turns its location engine on while [active] and
/// hands every update to [deliver]. The engine is off otherwise, so the device does not track the user
/// in the background of the explore screen.
library;

import 'package:flutter/foundation.dart';

import '../../core/location/locate.dart';

/// A location update as the map reports it, without the plugin type so the source stays testable.
@immutable
class MapLocationUpdate {
  const MapLocationUpdate({required this.lat, required this.lon, required this.accuracyM, required this.timestamp});

  final double lat;
  final double lon;

  /// Null when the engine did not report it.
  final double? accuracyM;
  final DateTime timestamp;
}

class MapFixSource extends ChangeNotifier implements FixSource {
  _MapFixSubscription? _subscription;

  /// The map keeps its location engine on exactly while a locate run listens.
  bool get active => _subscription != null;

  @override
  FixSubscription listen(void Function(LocatedFix fix) onFix, void Function(LocateError error) onError) {
    _subscription?._closed = true;
    final subscription = _MapFixSubscription(this, onFix);
    _subscription = subscription;
    notifyListeners();
    return subscription;
  }

  /// Called by the map for each location update; ignored while nobody listens.
  void deliver(MapLocationUpdate update) {
    final subscription = _subscription;
    if (subscription == null || subscription._closed) return;
    if (!update.lat.isFinite || !update.lon.isFinite || update.lat.abs() > 90 || update.lon.abs() > 180) return;
    final accuracy = update.accuracyM;
    subscription.onFix(LocatedFix(
      lat: update.lat,
      lon: update.lon,
      // A fix without an accuracy is treated as the least precise one: it is shown but never trusted.
      accuracyM: accuracy != null && accuracy.isFinite && accuracy >= 0 ? accuracy : double.infinity,
      timestampMs: update.timestamp.millisecondsSinceEpoch,
    ));
  }

  void _release(_MapFixSubscription subscription) {
    if (!identical(_subscription, subscription)) return;
    _subscription = null;
    notifyListeners();
  }
}

class _MapFixSubscription implements FixSubscription {
  _MapFixSubscription(this._source, this.onFix);

  final MapFixSource _source;
  final void Function(LocatedFix fix) onFix;
  var _closed = false;

  @override
  void cancel() {
    if (_closed) return;
    _closed = true;
    _source._release(this);
  }
}
