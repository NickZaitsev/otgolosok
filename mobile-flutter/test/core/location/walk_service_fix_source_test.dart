import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/location/locate.dart';
import 'package:otgolosok/core/location/walk_service_fix_source.dart';
import 'package:otgolosok/core/location/walk_service_permissions.dart';
import 'package:walk_service/walk_service.dart';

/// The plugin's location calls in memory: each `currentLocation` waits until the test answers it.
class _Host extends WalkServiceHostApi {
  final requests = <({LocationPriority priority, int maxAgeMs, int timeoutMs, Completer<Fix?> answer})>[];
  final calls = <String>[];
  PermissionStatus location = PermissionStatus.denied;
  PermissionStatus afterDialog = PermissionStatus.granted;
  bool servicesOn = true;

  @override
  Future<PermissionState> permissionState() async {
    calls.add('permissionState');
    return PermissionState(location: location, notifications: PermissionStatus.denied, preciseLocation: location == PermissionStatus.granted);
  }

  @override
  Future<PermissionState> requestPermissions() async {
    calls.add('requestPermissions');
    location = afterDialog;
    return permissionState();
  }

  @override
  Future<PermissionState> requestLocationPermission() async {
    calls.add('requestLocationPermission');
    location = afterDialog;
    return permissionState();
  }

  @override
  Future<bool> locationServicesEnabled() async {
    calls.add('locationServicesEnabled');
    return servicesOn;
  }

  @override
  Future<Fix?> currentLocation(LocationPriority priority, int maxAgeMs, int timeoutMs) {
    final answer = Completer<Fix?>();
    requests.add((priority: priority, maxAgeMs: maxAgeMs, timeoutMs: timeoutMs, answer: answer));
    return answer.future;
  }

  @override
  Future<void> cancelCurrentLocation() async => calls.add('cancelCurrentLocation');

  Completer<Fix?> answer(LocationPriority priority) => requests.lastWhere((request) => request.priority == priority).answer;
}

Fix _fix(double accuracy, {double lat = 55.7558}) => Fix(lat: lat, lon: 37.6173, accuracyM: accuracy, timestampMs: 1, provider: 'fused');

PlatformException _error(String code, [String? details]) => PlatformException(code: code, message: 'native', details: details);

void main() {
  late _Host host;
  late List<LocatedFix> fixes;
  late List<LocateError> errors;
  late FixSubscription subscription;

  void listen() {
    subscription = WalkServiceFixSource(api: host).listen(fixes.add, errors.add);
  }

  setUp(() {
    host = _Host();
    fixes = [];
    errors = [];
  });

  test('asks for a quick coarse fix and a precise one at once, with the site limits', () {
    listen();
    expect([for (final request in host.requests) (request.priority, request.maxAgeMs, request.timeoutMs)], [
      (LocationPriority.coarse, 60000, 10000),
      (LocationPriority.precise, 0, 20000),
    ]);
  });

  test('refine path: the coarse fix, then the precise one, then the end of the source', () async {
    listen();
    host.answer(LocationPriority.coarse).complete(_fix(800));
    await pumpEventQueue();
    expect(fixes.map((fix) => fix.accuracyM), [800]);
    expect(errors, isEmpty);

    host.answer(LocationPriority.precise).complete(_fix(12));
    await pumpEventQueue();
    expect(fixes.map((fix) => fix.accuracyM), [800, 12]);
    // Nothing left to refine with: the locator settles on its best fix.
    expect(errors, [LocateError.timeout]);
    expect(host.calls, isNot(contains('cancelCurrentLocation')));
  });

  test('no fix from either request is a timeout', () async {
    listen();
    host.answer(LocationPriority.coarse).complete(null);
    host.answer(LocationPriority.precise).complete(null);
    await pumpEventQueue();
    expect(errors, [LocateError.timeout]);
  });

  test('a fix with impossible coordinates counts as none', () async {
    listen();
    host.answer(LocationPriority.coarse).complete(_fix(50, lat: 120));
    host.answer(LocationPriority.precise).complete(null);
    await pumpEventQueue();
    expect(fixes, isEmpty);
    expect(errors, [LocateError.timeout]);
  });

  test('location switched off is reported as such once both requests end', () async {
    listen();
    host.answer(LocationPriority.coarse).completeError(_error('location_unavailable', 'location_disabled'));
    await pumpEventQueue();
    expect(errors, isEmpty);
    host.answer(LocationPriority.precise).completeError(_error('location_unavailable', 'location_disabled'));
    await pumpEventQueue();
    expect(errors, [LocateError.servicesDisabled]);
  });

  test('a failed request outranks a timeout of the other one', () async {
    listen();
    host.answer(LocationPriority.coarse).complete(null);
    host.answer(LocationPriority.precise).completeError(_error('location_unavailable', 'request_failed'));
    await pumpEventQueue();
    expect(errors, [LocateError.positionUnavailable]);
  });

  test('a coarse failure still lets the precise request deliver', () async {
    listen();
    host.answer(LocationPriority.coarse).completeError(_error('location_unavailable', 'request_failed'));
    await pumpEventQueue();
    host.answer(LocationPriority.precise).complete(_fix(9));
    await pumpEventQueue();
    expect(fixes.map((fix) => fix.accuracyM), [9]);
  });

  test('a denied permission ends at once and stops the other request', () async {
    listen();
    host.answer(LocationPriority.coarse).completeError(_error('permission_denied', 'permission_missing'));
    await pumpEventQueue();
    expect(errors, [LocateError.permissionDenied]);
    expect(host.calls, contains('cancelCurrentLocation'));

    host.answer(LocationPriority.precise).complete(_fix(5));
    await pumpEventQueue();
    expect(fixes, isEmpty);
    expect(errors, [LocateError.permissionDenied]);
  });

  test('cancelling stops the native requests and ignores their late answers', () async {
    listen();
    subscription.cancel();
    expect(host.calls, ['cancelCurrentLocation']);
    host.answer(LocationPriority.coarse).complete(_fix(100));
    host.answer(LocationPriority.precise).complete(null);
    await pumpEventQueue();
    expect(fixes, isEmpty);
    expect(errors, isEmpty);
  });

  group('with the locator', () {
    final updates = <LocateUpdate>[];

    void Function() locate() => Locator(
          permissions: WalkServiceLocationPermissions(host),
          services: WalkServiceLocationServices(host),
          source: WalkServiceFixSource(api: host),
        ).locate(updates.add);

    setUp(updates.clear);

    test('asks for location only, never for notifications', () async {
      locate();
      await pumpEventQueue();
      expect(host.calls, ['permissionState', 'requestLocationPermission', 'permissionState', 'locationServicesEnabled']);
      expect(host.requests, hasLength(2));
    });

    test('permission denied in the dialog', () async {
      host.afterDialog = PermissionStatus.denied;
      locate();
      await pumpEventQueue();
      expect(updates.single, isA<LocateErrorUpdate>().having((update) => update.error, 'error', LocateError.permissionDenied));
      expect(host.requests, isEmpty);
    });

    test('permission denied for good: no dialog', () async {
      host.location = PermissionStatus.permanentlyDenied;
      locate();
      await pumpEventQueue();
      expect(updates.single, isA<LocateErrorUpdate>().having((update) => update.error, 'error', LocateError.permissionDenied));
      expect(host.calls, isNot(contains('requestLocationPermission')));
    });

    test('location switched off: no request, the services error', () async {
      host.location = PermissionStatus.granted;
      host.servicesOn = false;
      locate();
      await pumpEventQueue();
      expect(updates.single, isA<LocateErrorUpdate>().having((update) => update.error, 'error', LocateError.servicesDisabled));
      expect(host.requests, isEmpty);
    });

    test('the coarse fix shows first and the precise one is final', () async {
      host.location = PermissionStatus.granted;
      locate();
      await pumpEventQueue();
      host.answer(LocationPriority.coarse).complete(_fix(600));
      await pumpEventQueue();
      host.answer(LocationPriority.precise).complete(_fix(15));
      await pumpEventQueue();
      expect([for (final update in updates) if (update case LocateFixUpdate(:final fix, :final isFinal)) (fix.accuracyM, isFinal)], [
        (600.0, false),
        (15.0, true),
      ]);
    });
  });
}
