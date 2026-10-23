import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/location/locate.dart';

class _Permissions implements LocationPermissions {
  _Permissions(this.state, {LocationAccess? afterRequest}) : afterRequest = afterRequest ?? state;

  LocationAccess state;
  LocationAccess afterRequest;
  Object? checkError;

  /// When set, the system dialog stays open until it completes.
  Completer<void>? dialog;
  var requests = 0;

  @override
  Future<LocationAccess> check() async {
    if (checkError != null) throw checkError!;
    return state;
  }

  @override
  Future<LocationAccess> request() async {
    requests++;
    await dialog?.future;
    return state = afterRequest;
  }

  @override
  Future<void> openSettings() async {}
}

class _Subscription implements FixSubscription {
  var cancelled = false;

  @override
  void cancel() => cancelled = true;
}

class _Source implements FixSource {
  void Function(LocatedFix fix)? onFix;
  void Function(LocateError error)? onError;
  _Subscription? subscription;
  var throwOnListen = false;

  @override
  FixSubscription listen(void Function(LocatedFix fix) onFix, void Function(LocateError error) onError) {
    if (throwOnListen) throw StateError('engine failed');
    this.onFix = onFix;
    this.onError = onError;
    return subscription = _Subscription();
  }

  void fix(double accuracy) => onFix!(LocatedFix(lat: 55.75, lon: 37.6, accuracyM: accuracy, timestampMs: accuracy.round()));
}

class _Timer implements Timer {
  _Timer(this.duration, this.callback);

  final Duration duration;
  final void Function() callback;
  var cancelled = false;

  void fire() {
    if (!cancelled) callback();
  }

  @override
  void cancel() => cancelled = true;

  @override
  bool get isActive => !cancelled;

  @override
  int get tick => 0;
}

const _config = LocateConfig(goodAccuracyM: 30, refine: Duration(seconds: 6), deadline: Duration(seconds: 20));

void main() {
  late _Permissions permissions;
  late _Source source;
  late List<_Timer> timers;
  late List<LocateUpdate> updates;

  _Timer timer(Duration duration) => timers.lastWhere((timer) => timer.duration == duration);

  Future<void Function()> locate() async {
    final locator = Locator(
      permissions: permissions,
      source: source,
      config: _config,
      startTimer: (duration, callback) {
        final timer = _Timer(duration, callback);
        timers.add(timer);
        return timer;
      },
    );
    final cancel = locator.locate(updates.add);
    await pumpEventQueue();
    return cancel;
  }

  List<(double, bool)> fixes() => [
        for (final update in updates)
          if (update case LocateFixUpdate(:final fix, :final isFinal)) (fix.accuracyM, isFinal),
      ];

  setUp(() {
    permissions = _Permissions(LocationAccess.granted);
    source = _Source();
    timers = [];
    updates = [];
  });

  test('the first fix shows at once and the best one after refining is final', () async {
    await locate();
    source.fix(120);
    source.fix(60);
    source.fix(90); // worse than the best so far: ignored
    expect(fixes(), [(120.0, false), (60.0, false)]);

    timer(_config.refine).fire();
    expect(fixes(), [(120.0, false), (60.0, false), (60.0, true)]);
    expect(source.subscription!.cancelled, isTrue);
    expect(timer(_config.deadline).cancelled, isTrue);

    // Nothing after the final update.
    source.fix(10);
    timer(_config.deadline).fire();
    expect(updates, hasLength(3));
  });

  test('a fix as good as wanted ends at once', () async {
    await locate();
    source.fix(25);
    expect(fixes(), [(25.0, true)]);
    expect(source.subscription!.cancelled, isTrue);
    expect(timers.where((timer) => timer.duration == _config.refine), isEmpty);
  });

  test('no fix before the deadline is a timeout', () async {
    await locate();
    timer(_config.deadline).fire();
    expect(updates.single, isA<LocateErrorUpdate>().having((update) => update.error, 'error', LocateError.timeout));
    expect(source.subscription!.cancelled, isTrue);
  });

  test('the deadline starts only after the permission dialog', () async {
    permissions = _Permissions(LocationAccess.denied, afterRequest: LocationAccess.granted)..dialog = Completer<void>();
    await locate();
    expect(permissions.requests, 1);
    expect(timers, isEmpty);
    expect(source.subscription, isNull);

    permissions.dialog!.complete();
    await pumpEventQueue();
    expect(timers.single.duration, _config.deadline);
    expect(source.subscription, isNotNull);
  });

  final refusals = <String, (_Permissions Function(), LocateError, int)>{
    'refused in the dialog': (() => _Permissions(LocationAccess.denied, afterRequest: LocationAccess.denied), LocateError.permissionDenied, 1),
    'blocked for good: no dialog': (() => _Permissions(LocationAccess.blocked), LocateError.permissionDenied, 0),
    'no location service': (() => _Permissions(LocationAccess.unsupported), LocateError.unsupported, 0),
    'a broken permission channel': (() => _Permissions(LocationAccess.granted)..checkError = StateError('no plugin'), LocateError.unsupported, 0),
  };
  refusals.forEach((name, value) {
    final (create, error, requests) = value;
    test(name, () async {
      permissions = create();
      await locate();
      expect(updates.single, isA<LocateErrorUpdate>().having((update) => update.error, 'error', error));
      expect(permissions.requests, requests);
      expect(source.subscription, isNull);
      expect(timers, isEmpty);
    });
  });

  test('an engine error after a fix settles on that fix', () async {
    await locate();
    source.fix(200);
    source.onError!(LocateError.positionUnavailable);
    expect(fixes(), [(200.0, false), (200.0, true)]);
  });

  test('an engine error without a fix is reported', () async {
    await locate();
    source.onError!(LocateError.positionUnavailable);
    expect(updates.single, isA<LocateErrorUpdate>().having((update) => update.error, 'error', LocateError.positionUnavailable));
  });

  test('a permission revoked while locating wins over the fix so far', () async {
    await locate();
    source.fix(200);
    source.onError!(LocateError.permissionDenied);
    expect(updates.last, isA<LocateErrorUpdate>().having((update) => update.error, 'error', LocateError.permissionDenied));
  });

  test('an engine that cannot start is a position error', () async {
    source.throwOnListen = true;
    await locate();
    expect(updates.single, isA<LocateErrorUpdate>().having((update) => update.error, 'error', LocateError.positionUnavailable));
    expect(timer(_config.deadline).cancelled, isTrue);
  });

  test('a cancelled run sends nothing more and stops the engine', () async {
    final cancel = await locate();
    source.fix(200);
    cancel();
    source.fix(10);
    timer(_config.refine).fire();
    expect(fixes(), [(200.0, false)]);
    expect(source.subscription!.cancelled, isTrue);
  });

  test('a run cancelled during the permission dialog never starts the engine', () async {
    permissions = _Permissions(LocationAccess.denied, afterRequest: LocationAccess.granted)..dialog = Completer<void>();
    final cancel = await locate();
    cancel();
    permissions.dialog!.complete();
    await pumpEventQueue();
    expect(source.subscription, isNull);
    expect(updates, isEmpty);
  });
}
