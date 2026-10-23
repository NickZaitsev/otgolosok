import 'package:walk_service/walk_service.dart';

import 'locate.dart';

/// The location permission through the walk service plugin, which owns every runtime permission of the app.
class WalkServiceLocationPermissions implements LocationPermissions {
  WalkServiceLocationPermissions([WalkServiceHostApi? api]) : _api = api ?? WalkServiceHostApi();

  final WalkServiceHostApi _api;

  @override
  Future<LocationAccess> check() async => _map((await _api.permissionState()).location);

  @override
  Future<LocationAccess> request() async => _map((await _api.requestPermissions()).location);

  @override
  Future<void> openSettings() => _api.openAppSettings();

  static LocationAccess _map(PermissionStatus status) => switch (status) {
        PermissionStatus.granted => LocationAccess.granted,
        PermissionStatus.denied => LocationAccess.denied,
        PermissionStatus.permanentlyDenied => LocationAccess.blocked,
      };
}
