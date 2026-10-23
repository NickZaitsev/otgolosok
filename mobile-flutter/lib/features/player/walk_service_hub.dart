import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:walk_service/walk_service.dart';

/// What holds the native walk service: a walk, a car walk's stop story or a place story.
enum SessionOwnerKind { walk, car, story }

/// One user of the walk service. The service runs one session at a time app-wide, so exactly
/// one owner receives its events; [WalkServiceHub] hands them over.
abstract interface class SessionOwner {
  SessionOwnerKind get ownerKind;

  void onFix(Fix fix);

  void onLocationStatus(LocationStatus status, String? code);

  void onPlayer(PlayerState state);

  void onMediaCommand(MediaCommand command);

  /// The service stopped without the owner asking (the system ended it, or the user's «Стоп»
  /// arrived as a command and the owner already let go). The owner ends its state; it must not
  /// call the host again for this session.
  void onSessionStopped();

  /// Another owner took the service over after the user agreed. The owner ends its state
  /// (saving what it needs) without calling `stopSession`: the session is reused.
  void onRevoked();
}

/// The single Dart side of the walk service contract: registers the Flutter API handler once and
/// routes every native event to the current [SessionOwner].
///
/// Taking the service over from another owner is a decision of the UI (it asks the user first);
/// the hub only performs it.
class WalkServiceHub extends ChangeNotifier implements WalkServiceFlutterApi {
  WalkServiceHub(this.host);

  final WalkServiceHostApi host;
  SessionOwner? _owner;
  bool _attached = false;

  /// Who holds the service now; null when it is free.
  SessionOwner? get owner => _owner;

  /// Whether another owner than [candidate] holds the service (the UI must ask before taking it).
  bool heldByOther(SessionOwner candidate) => _owner != null && !identical(_owner, candidate);

  /// Registers this hub as the receiver of native events. Idempotent.
  void attach() {
    if (_attached) return;
    WalkServiceFlutterApi.setUp(this);
    _attached = true;
  }

  /// Stops a service left running without a Dart owner (after a hot restart in debug, or if Dart
  /// restarted while the process lived). Errors are logged: nothing is running then.
  Future<void> reconcile() async {
    try {
      if (_owner == null && await host.isSessionActive()) await host.stopSession();
    } on Object catch (error) {
      debugPrint('walk service reconcile failed: ${error.runtimeType}');
    }
  }

  /// Starts (or reconfigures) the session for [owner]. Must run inside a user tap: Android
  /// refuses to start the foreground service from the background. A previous owner is revoked
  /// first and its audio silenced; on failure nobody owns the service and the error is rethrown
  /// (a [PlatformException] with the contract codes).
  Future<void> acquire(SessionOwner owner, SessionConfig config) async {
    final previous = _owner;
    if (previous != null && !identical(previous, owner)) {
      _owner = null;
      previous.onRevoked();
      await _quietly(host.pause);
    }
    _owner = owner;
    notifyListeners();
    try {
      await host.startSession(config);
    } on Object {
      if (identical(_owner, owner)) {
        _owner = null;
        notifyListeners();
      }
      // A session reconfigured from a revoked owner must not keep running without anyone.
      if (previous != null && !identical(previous, owner)) await _quietly(host.stopSession);
      rethrow;
    }
  }

  /// Ends [owner]'s session. Ignored when it no longer owns the service.
  Future<void> release(SessionOwner owner) async {
    if (!identical(_owner, owner)) return;
    _owner = null;
    notifyListeners();
    await _quietly(host.stopSession);
  }

  /// Revokes the current owner and stops the service (e.g. the user confirmed leaving it).
  Future<void> stopCurrent() async {
    final current = _owner;
    if (current == null) return;
    _owner = null;
    current.onRevoked();
    notifyListeners();
    await _quietly(host.stopSession);
  }

  Future<void> _quietly(Future<void> Function() call) async {
    try {
      await call();
    } on Object catch (error) {
      // Stopping or pausing a session that is already gone changes nothing for the user.
      debugPrint('walk service call failed: ${error.runtimeType}');
    }
  }

  // ---- WalkServiceFlutterApi (native → Dart) ----

  @override
  void onFix(Fix fix) => _owner?.onFix(fix);

  @override
  void onLocationStatus(LocationStatus status, String? code) => _owner?.onLocationStatus(status, code);

  @override
  void onPlayer(PlayerState state) => _owner?.onPlayer(state);

  @override
  void onMediaCommand(MediaCommand command) => _owner?.onMediaCommand(command);

  @override
  void onSessionStopped() {
    final current = _owner;
    if (current == null) return;
    _owner = null;
    current.onSessionStopped();
    notifyListeners();
  }

  /// Owners may release the service while their screens unmount after the hub itself was
  /// disposed (the app scope closes first): the native session still has to stop, nobody listens.
  bool _disposed = false;

  bool get disposed => _disposed;

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    if (_attached) WalkServiceFlutterApi.setUp(null);
    _attached = false;
    _disposed = true;
    super.dispose();
  }
}
