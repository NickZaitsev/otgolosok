import 'dart:async';

import 'package:dio/dio.dart' show CancelToken;
import 'package:flutter/foundation.dart' show mapEquals;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../app/router.dart' show walkActiveProvider;
import '../../core/api/api_error.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../../core/i18n/user_message.dart';
import '../../walk_engine/walk_view.dart';
import '../offline/offline_copy.dart';
import '../offline/offline_providers.dart';
import '../reviews/review_model.dart';
import '../reviews/reviews_api.dart';
import '../reviews/walk_reviews_controller.dart';
import 'local_walks.dart';
import 'walk_intro.dart';
import 'walk_link.dart';
import 'walk_loader.dart';

/// Opens walks for the walk screen; the local store comes from the walk builder.
final walkLoaderProvider = Provider<WalkLoader>((ref) => WalkLoader(
      api: ref.watch(apiProvider),
      packs: ref.watch(offlinePacksProvider),
      localStore: () => ref.read(localWalkStoreProvider),
    ));

ContentLocale contentLocaleOf(AppLocale locale) => switch (locale) {
      AppLocale.ru => ContentLocale.ru,
      AppLocale.en => ContentLocale.en,
      AppLocale.zh => ContentLocale.zh,
    };

/// Reviews are kept by the server for catalogue, shared and account walks; a local guest walk
/// exists only on the device, so it has none.
ReviewTarget? reviewTargetOf(WalkLink link) => switch (link) {
      CatalogWalkLink(:final slug) => CatalogReviewTarget(slug),
      SharedWalkLink(:final token) => SharedReviewTarget(token),
      AccountWalkLink(:final id) => AccountReviewTarget(id),
      LocalWalkLink() => null,
    };

/// Why an opened walk cannot start from [WalkLink.fromStop]; null when it can.
String? fromStopProblem(BuildContext context, WalkView view, String? fromStop) {
  if (fromStop == null) return null;
  if (view.document.driving) return context.t('Автомобильную прогулку нужно начинать с первой парковки. Откройте маршрут целиком.');
  if (!view.document.stops.any((stop) => stop.id == fromStop)) {
    return context.t('Точка начала больше не входит в эту прогулку. Откройте подборку заново.');
  }
  return null;
}

/// `/walk?…` (site `walk-screen.tsx`): loads the walk, falls back to its offline copy, follows a
/// moved catalogue walk, and shows the walk with its tools around the player.
class WalkScreen extends ConsumerStatefulWidget {
  const WalkScreen({super.key, required this.link});

  final WalkLink link;

  @override
  ConsumerState<WalkScreen> createState() => _WalkScreenState();
}

sealed class _State {
  const _State();
}

class _Loading extends _State {
  const _Loading();
}

class _Failed extends _State {
  const _Failed(this.error);
  final Object error;
}

class _Ready extends _State {
  const _Ready(this.link, this.walk, this.localAudio, this.reviews, this.offline);

  /// The link the walk was opened with; it keeps its start stop when the walk card reopens it.
  final WalkLink link;
  final LoadedWalk walk;
  final Map<String, Uri> localAudio;
  final WalkReviewsController? reviews;
  final OfflineCopyController? offline;
}

class _WalkScreenState extends ConsumerState<WalkScreen> {
  _State _state = const _Loading();
  String? _key;

  /// [_key] without the start stop.
  String? _walkKey;
  CancelToken? _cancel;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _loadIfNeeded();
  }

  @override
  void didUpdateWidget(WalkScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    _loadIfNeeded();
  }

  @override
  void dispose() {
    _cancel?.cancel();
    _disposeControllers(_state);
    super.dispose();
  }

  void _disposeControllers(_State state) {
    if (state is _Ready) {
      state.reviews?.dispose();
      state.offline?.dispose();
    }
  }

  /// Called right before a build, so the loading state needs no extra rebuild.
  void _loadIfNeeded() {
    // The language is part of the key: a switch reloads the walk in the new language.
    final link = widget.link;
    final key = '${context.appLocale.name}:${link.location}';
    if (key == _key) return;
    final walkKey = '${context.appLocale.name}:${Uri(path: '/walk', queryParameters: link.query)}';
    // The walk card opens the walk without its start stop: the running walk stays as it is.
    final reopened = link.fromStop == null && walkKey == _walkKey && _state is _Ready && ref.read(walkActiveProvider);
    _key = key;
    _walkKey = walkKey;
    if (reopened) return;
    _replace(const _Loading());
    unawaited(_load());
  }

  /// Old controllers are disposed after the frame that stops showing them.
  void _replace(_State next) {
    final previous = _state;
    _state = next;
    if (previous is _Ready) WidgetsBinding.instance.addPostFrameCallback((_) => _disposeControllers(previous));
  }

  void _setState(_State next) => setState(() => _replace(next));

  Future<void> _load() async {
    _cancel?.cancel();
    final cancel = _cancel = CancelToken();
    final link = widget.link;
    final locale = contentLocaleOf(context.appLocale);
    try {
      final userId = offlineOwnerId(ref.read(sessionStoreProvider), ref.read(settingsProvider));
      final walk = await ref.read(walkLoaderProvider).load(link, locale: locale, userId: userId, cancel: cancel);
      final packs = ref.read(offlinePacksProvider);
      final localAudio = await packs.localRecordings(walk.view);
      if (!mounted || cancel.isCancelled) return;
      final target = reviewTargetOf(link);
      final api = ref.read(apiProvider);
      final reviews = target == null
          ? null
          : WalkReviewsController(target: target, api: ReviewsApi(api), drafts: ReviewDrafts(ref.read(settingsProvider)));
      final offlineRef = walk.offlineRef;
      final offline = offlineRef == null ? null : OfflineCopyController(packs: packs, ref: offlineRef);
      offline?.addListener(() => unawaited(_offlineChanged(offline)));
      _setState(_Ready(link, walk, localAudio, reviews, offline));
    } on ApiError catch (error) {
      if (!mounted || cancel.isCancelled || error.isCancelled) return;
      final moved = error.movedToShare;
      if (moved != null) {
        // A catalogue walk moved to a shared walk: its old link opens the new one.
        context.replace(SharedWalkLink(moved, fromStop: link.fromStop).location);
        return;
      }
      _setState(_Failed(error));
    } on Exception catch (error) {
      if (!mounted || cancel.isCancelled) return;
      _setState(_Failed(error));
    }
  }

  /// A saved or removed copy changes which recordings the player takes from the device.
  Future<void> _offlineChanged(OfflineCopyController offline) async {
    if (offline.busy) return;
    final state = _state;
    if (state is! _Ready || !identical(state.offline, offline)) return;
    final localAudio = await ref.read(offlinePacksProvider).localRecordings(state.walk.view);
    final current = _state;
    if (!mounted || current is! _Ready || !identical(current.offline, offline) || mapEquals(current.localAudio, localAudio)) return;
    // The same controllers stay: only the recordings change.
    setState(() => _state = _Ready(current.link, current.walk, localAudio, current.reviews, offline));
  }

  void _retry() => setState(() {
        _key = null;
        _loadIfNeeded();
      });

  @override
  Widget build(BuildContext context) {
    final state = _state;
    return switch (state) {
      _Loading() => Scaffold(
          appBar: AppBar(),
          body: Center(
            child: Semantics(
              liveRegion: true,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const CircularProgressIndicator(),
                const SizedBox(height: 16),
                Text(context.t('Открываем прогулку…')),
              ]),
            ),
          ),
        ),
      _Failed(:final error) => WalkErrorView(
          message: userMessage(context, error, 'Не удалось открыть прогулку.'),
          onRetry: error is ApiError && (error.retryable || error.allowsOfflineFallback) ? _retry : null,
        ),
      _Ready() => _ready(state),
    };
  }

  Widget _ready(_Ready state) {
    final problem = fromStopProblem(context, state.walk.view, state.link.fromStop);
    if (problem != null) return WalkErrorView(message: problem);
    return WalkReadyView(link: state.link, walk: state.walk, localAudio: state.localAudio, reviews: state.reviews, offline: state.offline);
  }
}

/// A walk that cannot be shown: the reason and the way back to the walks (site `WalkError`).
class WalkErrorView extends StatelessWidget {
  const WalkErrorView({super.key, required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          Semantics(liveRegion: true, child: Text(message, style: Theme.of(context).textTheme.titleMedium)),
          const SizedBox(height: 16),
          if (onRetry != null) FilledButton(onPressed: onRetry, child: Text(context.t('Повторить'))),
          TextButton(onPressed: () => context.go('/account/walks'), child: Text(context.t('Вернуться к прогулкам'))),
        ]),
      );
}
