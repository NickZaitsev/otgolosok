import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';
import 'package:walk_service/walk_service.dart';

/// The native walk service in memory: records every call, can refuse a call with a contract
/// error code, and keeps the session flag like the service does.
class FakeHost extends WalkServiceHostApi {
  FakeHost();

  final calls = <String>[];
  final sessions = <SessionConfig>[];
  final tracks = <Track>[];
  final cards = <CardState>[];
  bool active = false;
  PermissionState permissions = PermissionState(
    location: PermissionStatus.granted,
    notifications: PermissionStatus.granted,
    preciseLocation: true,
  );

  /// What [requestPermissions] answers (the user's choice in the system dialog).
  PermissionState? granted;

  /// Error codes the next calls of a method throw, in order (`startSession` → [`fgs_not_allowed`]).
  final refusals = <String, List<String>>{};

  void _call(String name) {
    calls.add(name);
    final codes = refusals[name];
    if (codes != null && codes.isNotEmpty) throw PlatformException(code: codes.removeAt(0), message: 'refused');
  }

  int count(String name) => calls.where((call) => call == name).length;

  @override
  Future<void> startSession(SessionConfig config) async {
    _call('startSession');
    sessions.add(config);
    active = true;
  }

  @override
  Future<void> stopSession() async {
    _call('stopSession');
    active = false;
  }

  @override
  Future<bool> isSessionActive() async {
    _call('isSessionActive');
    return active;
  }

  @override
  Future<void> play(Track track) async {
    _call('play');
    tracks.add(track);
  }

  @override
  Future<void> pause() async => _call('pause');

  @override
  Future<void> resume() async => _call('resume');

  @override
  Future<void> seekTo(int ms) async => _call('seekTo $ms');

  @override
  Future<void> seekBy(int ms) async => _call('seekBy $ms');

  @override
  Future<void> setRate(double rate) async => _call('setRate $rate');

  @override
  Future<void> prefetch(String uri) async => _call('prefetch');

  @override
  Future<void> updateCard(CardState state) async {
    _call('updateCard');
    cards.add(state);
  }

  @override
  Future<PermissionState> permissionState() async {
    _call('permissionState');
    return permissions;
  }

  @override
  Future<PermissionState> requestPermissions() async {
    _call('requestPermissions');
    permissions = granted ?? permissions;
    return permissions;
  }

  @override
  Future<void> openAppSettings() async => _call('openAppSettings');
}

Map<String, Object?> _json(String path) => jsonDecode(File(path).readAsStringSync()) as Map<String, Object?>;

/// The engine fixture's walk «Арбат» (`arbat-test`): stops a, b, c with recordings
/// `/api/story-audio/aaa….mp3` …, the finish next to c.
Map<String, Object?> walkViewJson() {
  final cases = (_json('test/fixtures/engine/walk_plan.json')['cases']! as List<Object?>).cast<Map<String, Object?>>();
  final found = cases.firstWhere((item) => item['name'] == 'near finish, forward');
  return jsonDecode(jsonEncode(found['view'])) as Map<String, Object?>;
}

WalkView walkView() => WalkView.fromJson(walkViewJson());

String audioOf(String letter) => '/api/story-audio/${letter * 64}.mp3';

/// The API fixture's valid car walk: one parking with the story «car-stop-1» and its recording.
WalkView carView() {
  final documents = (_json('test/fixtures/api/walk_view.json')['documents']! as List<Object?>).cast<Map<String, Object?>>();
  final car = jsonDecode(jsonEncode(documents.firstWhere((item) => item['name'] == 'valid car walk')['input'])) as Map<String, Object?>;
  final view = walkViewJson();
  final chapter = ((view['chapters']! as List<Object?>).first! as Map<String, Object?>)..['id'] = 'car-stop-1';
  view['document'] = car;
  view['chapters'] = [chapter];
  return WalkView.fromJson(view);
}
