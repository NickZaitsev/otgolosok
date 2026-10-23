import 'package:walk_service/walk_service.dart';

import 'locate.dart';

/// The location permission through the walk service plugin, which owns every runtime permission of the app.
///
/// [request] asks for location only: the notification permission belongs to the walk start
/// (`requestPermissions`), not to a tap on «Моё местоположение».
class WalkServiceLocationPermissions implements LocationPermissions {
  WalkServiceLocationPermissions([WalkServiceHostApi? api]) : _api = api ?? WalkServiceHostApi();

  final WalkServiceHostApi _api;

  @override
  Future<LocationAccess> check() async => _map((await _api.permissionState()).location);

  @override
  Future<LocationAccess> request() async => _map((await _api.requestLocationPermission()).location);

  @override
  Future<void> openSettings() => _api.openAppSettings();

  static LocationAccess _map(PermissionStatus status) => switch (status) {
        PermissionStatus.granted => LocationAccess.granted,
        PermissionStatus.denied => LocationAccess.denied,
        PermissionStatus.permanentlyDenied => LocationAccess.blocked,
      };
}

/// The device location switch through the walk service plugin.
class WalkServiceLocationServices implements LocationServices {
  WalkServiceLocationServices([WalkServiceHostApi? api]) : _api = api ?? WalkServiceHostApi();

  final WalkServiceHostApi _api;

  @override
  Future<bool> enabled() => _api.locationServicesEnabled();

  @override
  Future<void> openSettings() => _api.openLocationSettings();
}
