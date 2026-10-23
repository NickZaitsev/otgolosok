/// The card of a catalog place on the explore map (site `StorySheet` for a catalog point).
///
/// Collapsed it is a peek (photo, title, the first paragraph, the player) that opens the story on tap;
/// expanded it is the whole story with the address, the source, sharing and the place rating.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../app/theme/tokens.g.dart';
import '../../core/api/api_error.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import 'place_feedback.dart';
import 'place_photo.dart';
import 'place_share.dart';
import 'place_story.dart';
import 'story_audio.dart';

enum PlaceStoryStatus { loading, ready, missing, error }

/// The non-Russian UI note on what is not translated yet (site `ContentLanguageNote`); null when nothing to say.
String? contentLanguageNote(AppLocale ui, AppLocale content, {required bool audioAvailable}) {
  if (ui == AppLocale.ru) return null;
  if (content == AppLocale.ru) {
    return audioAvailable
        ? 'Текст и аудио этой истории пока доступны только на русском языке.'
        : 'Текст этой истории пока доступен только на русском языке. Озвучка готовится.';
  }
  if (content == ui && !audioAvailable) return 'Озвучка этой истории на выбранном языке ещё готовится.';
  return null;
}

/// The card body for one place. Key it by the place id: requests, drafts and photo failures never cross places.
class PlaceStoryCard extends ConsumerStatefulWidget {
  const PlaceStoryCard({
    super.key,
    required this.placeId,
    required this.title,
    required this.address,
    required this.expanded,
    required this.onExpand,
    required this.onCollapse,
    required this.onClose,
    this.hasPhoto = false,
    this.onMissing,
  });

  final String placeId;

  /// From the map index (or a link); the detail's own header replaces them once loaded.
  final String title;
  final String address;
  final bool hasPhoto;
  final bool expanded;
  final VoidCallback onExpand;
  final VoidCallback onCollapse;
  final VoidCallback onClose;

  /// The index still shows a story that is gone: the screen refreshes the map cells.
  final VoidCallback? onMissing;

  @override
  ConsumerState<PlaceStoryCard> createState() => _PlaceStoryCardState();
}

class _PlaceStoryCardState extends ConsumerState<PlaceStoryCard> {
  var _status = PlaceStoryStatus.loading;
  PlaceStory? _story;
  AppLocale? _locale;
  var _attempt = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = context.appLocale;
    if (locale != _locale) {
      _locale = locale;
      _load();
    }
  }

  void _load() {
    final locale = _locale!;
    final repository = ref.read(placeStoryRepositoryProvider);
    final cached = repository.cached(widget.placeId, locale);
    if (cached != null) {
      _status = PlaceStoryStatus.ready;
      _story = cached;
      return;
    }
    final attempt = ++_attempt;
    _status = PlaceStoryStatus.loading;
    unawaited(repository.load(widget.placeId, locale).then((story) {
      if (!mounted || attempt != _attempt) return;
      setState(() {
        _story = story;
        _status = story == null ? PlaceStoryStatus.missing : PlaceStoryStatus.ready;
      });
      if (story == null) widget.onMissing?.call();
    }, onError: (Object error) {
      if (!mounted || attempt != _attempt) return;
      if (error is! ApiError && error is! FormatException) debugPrint('Place story failed: $error');
      setState(() => _status = PlaceStoryStatus.error);
    }));
  }

  void _retry() => setState(_load);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final story = _story;
    final title = story?.place?.title ?? widget.title;
    final address = story?.place?.address ?? widget.address;
    final peek = !widget.expanded;
    final ready = _status == PlaceStoryStatus.ready && story != null;
    final paragraphs = story?.paragraphs ?? const <String>[];
    final note = ready && (paragraphs.isNotEmpty || story.audioUrl != null)
        ? contentLanguageNote(context.appLocale, story.actualLocale, audioAvailable: story.audioUrl != null)
        : null;
    final textStyle = theme.textTheme.bodyLarge?.copyWith(fontSize: TokenSizes.textSheetBody, height: TokenNumbers.leadingBody);
    final contentLocale = story?.actualLocale.flutterLocale;

    final heading = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          header: true,
          child: Text(title, style: theme.textTheme.titleLarge?.copyWith(fontSize: TokenSizes.textSheetTitle), locale: contentLocale),
        ),
        // The peek names the place only; the address waits in the expanded card.
        if (!peek && address != title)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(address, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
      ],
    );

    final children = <Widget>[
      PlacePhotoBanner(
        key: ValueKey(widget.placeId),
        photo: story?.photo,
        title: title,
        pending: widget.hasPhoto && _status == PlaceStoryStatus.loading,
        maxHeight: peek ? 160 : null,
        onPreview: peek ? widget.onExpand : null,
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, TokenSizes.spaceSm, TokenSizes.spaceXs, 0),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: peek ? InkWell(onTap: widget.onExpand, child: heading) : heading),
            IconButton(tooltip: context.t('Закрыть карточку'), onPressed: widget.onClose, icon: const Icon(Icons.close)),
          ],
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(TokenSizes.spaceMd, TokenSizes.spaceXs, TokenSizes.spaceMd, TokenSizes.spaceMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (note != null) _Note(context.t(note)),
            if (_status == PlaceStoryStatus.loading) _Status(context.t('Загружаем рассказ…')),
            if (_status == PlaceStoryStatus.error) ...[
              _Status(context.t('Не удалось загрузить рассказ.')),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(onPressed: _retry, child: Text(context.t('Повторить'))),
              ),
            ],
            if (_status == PlaceStoryStatus.missing) _Status(context.t('Эта история больше недоступна.')),
            if (ready && paragraphs.isNotEmpty)
              peek
                  ? InkWell(
                      onTap: widget.onExpand,
                      child: Text(paragraphs.first, maxLines: 4, overflow: TextOverflow.ellipsis, style: textStyle, locale: contentLocale),
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final paragraph in paragraphs)
                          Padding(
                            padding: const EdgeInsets.only(bottom: TokenSizes.spaceSm),
                            child: Text(paragraph, style: textStyle, locale: contentLocale),
                          ),
                      ],
                    ),
            if (ready && !peek && story.attribution != null) _Attribution(story.attribution!),
            if (ready && !peek && paragraphs.isEmpty)
              _Status(context.t(story.audioUrl != null
                  ? 'Проверенный текст доступен в карточке места; запись можно слушать здесь.'
                  : 'Проверенный текст доступен в карточке места; озвучивание ещё не готово.')),
            if (ready && story.audioUrl != null)
              Padding(
                padding: const EdgeInsets.only(top: TokenSizes.spaceSm),
                child: StoryListenButton(placeId: widget.placeId, story: story, title: title, address: address),
              ),
            // Only the reading view offers sharing and rating, after the text.
            if (ready && !peek)
              Padding(
                padding: const EdgeInsets.only(top: TokenSizes.spaceSm),
                child: PlaceShareButton(key: ValueKey('share:${widget.placeId}'), placeId: widget.placeId, title: title),
              ),
            if (ready && !peek && canRatePlace(widget.placeId))
              Padding(
                padding: const EdgeInsets.only(top: TokenSizes.spaceMd),
                child: PlaceFeedbackPanel(key: ValueKey('feedback:${widget.placeId}'), placeId: widget.placeId, title: title),
              ),
          ],
        ),
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        _SheetHandle(expanded: widget.expanded, onExpand: widget.onExpand, onCollapse: widget.onCollapse),
        Flexible(
          child: SingleChildScrollView(
            physics: peek ? const NeverScrollableScrollPhysics() : null,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
          ),
        ),
      ],
    );
  }
}

/// The grab handle of an expandable card: a tap or a vertical drag opens or closes the story.
class _SheetHandle extends StatelessWidget {
  const _SheetHandle({required this.expanded, required this.onExpand, required this.onCollapse});

  final bool expanded;
  final VoidCallback onExpand;
  final VoidCallback onCollapse;

  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        expanded: expanded,
        label: context.t(expanded ? 'Свернуть историю' : 'Читать историю полностью'),
        excludeSemantics: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: expanded ? onCollapse : onExpand,
          onVerticalDragEnd: (details) {
            final velocity = details.primaryVelocity ?? 0;
            if (velocity < -100 && !expanded) onExpand();
            if (velocity > 100 && expanded) onCollapse();
          },
          child: SizedBox(
            height: TokenSizes.controlMin,
            child: Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(color: TokenColors.controlBorder, borderRadius: BorderRadius.circular(2)),
              ),
            ),
          ),
        ),
      );
}

class _Status extends StatelessWidget {
  const _Status(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: TokenSizes.spaceXs),
        child: Semantics(liveRegion: true, child: Text(text)),
      );
}

class _Note extends StatelessWidget {
  const _Note(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: TokenSizes.spaceSm),
        child: Text(text, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      );
}

class _Attribution extends StatelessWidget {
  const _Attribution(this.attribution);

  final SourceAttribution attribution;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall;
    return Semantics(
      link: true,
      child: InkWell(
        onTap: () => openExternalLink(context, Uri.parse(attribution.url)),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: TokenSizes.controlPrimaryMin),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text.rich(TextSpan(style: style, children: [
              TextSpan(text: '${context.t('Источник:')} '),
              TextSpan(text: context.t(attribution.label), style: const TextStyle(decoration: TextDecoration.underline)),
            ])),
          ),
        ),
      ),
    );
  }
}

/// «Слушать» for a place story through the walk service; nothing when the player is not bound.
class StoryListenButton extends ConsumerWidget {
  const StoryListenButton({super.key, required this.placeId, required this.story, required this.title, required this.address});

  final String placeId;
  final PlaceStory story;
  final String title;
  final String address;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(storyAudioControllerProvider);
    final audioUrl = story.audioUrl;
    if (controller == null || audioUrl == null) return const SizedBox.shrink();
    final origin = ref.watch(configProvider).origin;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final state = controller.state;
        final mine = state.placeId == placeId;
        final phase = mine ? state.phase : StoryAudioPhase.idle;
        final (label, icon, onPressed) = switch (phase) {
          StoryAudioPhase.playing => (context.t('Пауза'), Icons.pause, () => unawaited(controller.pause())),
          StoryAudioPhase.paused => (context.t('Продолжить'), Icons.play_arrow, () => unawaited(controller.resume())),
          StoryAudioPhase.preparing => (context.t('Загружаем запись…'), Icons.hourglass_empty, null),
          StoryAudioPhase.idle || StoryAudioPhase.failed => (
              context.t('Слушать'),
              Icons.headphones,
              () => unawaited(controller.play(StoryAudioRequest(
                    placeId: placeId,
                    url: _absolute(origin, audioUrl),
                    title: title,
                    subtitle: address,
                    artworkUrl: story.photo == null ? null : placePhotoUrl(origin, story.photo!.thumbnail),
                    durationSec: story.durationSec,
                  ))),
            ),
        };
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            FilledButton.icon(onPressed: onPressed, icon: Icon(icon), label: Text(label)),
            if (mine && phase == StoryAudioPhase.failed && state.error != null)
              Padding(
                padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
                child: Semantics(
                  liveRegion: true,
                  child: Text(context.t(state.error!), style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
              ),
          ],
        );
      },
    );
  }

  static Uri _absolute(Uri origin, String url) => url.startsWith('/') ? origin.replace(path: url) : Uri.parse(url);
}
