import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:walk_service/walk_service.dart';

import '../../app/providers.dart';
import '../../app/router.dart' show walkActiveProvider;
import 'story_listen.dart';
import 'walk_service_hub.dart';

/// The native walk service; tests override it with a fake.
final walkServiceHostApiProvider = Provider<WalkServiceHostApi>((ref) => WalkServiceHostApi());

/// The app-wide owner of the walk service: registers the native event handler once.
final walkServiceHubProvider = Provider<WalkServiceHub>((ref) {
  final hub = WalkServiceHub(ref.watch(walkServiceHostApiProvider))..attach();
  ref.onDispose(hub.dispose);
  return hub;
});

/// Place stories in a listen session (no GPS); one controller for the whole app.
final storyListenControllerProvider = Provider<StoryListenController>((ref) {
  final controller = StoryListenController(
    hub: ref.watch(walkServiceHubProvider),
    settings: ref.watch(settingsProvider),
    translations: ref.watch(translationsProvider),
    locale: () => ref.read(localeProvider),
  );
  ref.onDispose(controller.dispose);
  return controller;
});

/// Publishes whether a walk runs (the router guards leaving it). Providers must not change while
/// the tree builds or unmounts, so the flag is set a microtask later; by then the whole scope may
/// be gone (the app is closing), and a walk that ended with its scope has nobody left to tell.
/// The hub lives exactly as long as the scope, so its disposal marks the scope as closed.
void Function(bool active) publishWalkActive(ProviderContainer container) {
  final hub = container.read(walkServiceHubProvider);
  return (active) => scheduleMicrotask(() {
        if (hub.disposed) return;
        container.read(walkActiveProvider.notifier).set(active);
      });
}
