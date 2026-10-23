import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import '../../walk_engine/walk_session.dart';
import '../../walk_engine/walk_settings.dart';
import '../../walk_engine/walk_view.dart' show ContentLocale;
import 'audio_controls.dart';
import 'story_view.dart';
import 'walk_player_controller.dart';

/// Shown in the settings when «По месту» is chosen but the walk has no location.
const placeModeWarning = 'Без геолокации «По месту» не сработает: остановки переключаются кнопкой «Дальше».';

Future<void> _sheet(BuildContext context, WidgetBuilder builder) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheet) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.95,
        builder: (context, scroll) => SingleChildScrollView(
          controller: scroll,
          padding: const EdgeInsets.all(TokenSizes.spaceMd),
          child: builder(context),
        ),
      ),
    );

/// «Остановка N из M»: jump to any stop of the running walk.
Future<void> showStopsDrawer(BuildContext context, WalkPlayerController controller) => _sheet(
      context,
      (context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final state = controller.state;
          final chapters = controller.chapters;
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Semantics(
              header: true,
              child: Text(context.t('Остановки · {count}', {'count': chapters.length}), style: Theme.of(context).textTheme.titleLarge),
            ),
            for (final (index, chapter) in chapters.indexed)
              ListTile(
                contentPadding: EdgeInsets.zero,
                selected: index == state.chapterIndex,
                leading: CircleAvatar(radius: 16, child: Text('${index + 1}')),
                title: Text(chapter.title),
                onTap: () {
                  Navigator.of(context).pop();
                  controller.selectChapter(index);
                },
              ),
          ]);
        },
      ),
    );

/// «Читать историю»: the address, the language note and the story with its sources.
Future<void> showStoryDrawer(BuildContext context, WalkPlayerController controller) {
  final index = controller.state.chapterIndex;
  final chapters = controller.chapters;
  if (index < 0 || index >= chapters.length) return Future.value();
  final chapter = chapters[index];
  final view = controller.chapterView(chapter.id);
  return _sheet(
    context,
    (context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Semantics(header: true, child: Text(chapter.title, style: Theme.of(context).textTheme.titleLarge)),
      if (chapter.title != chapter.step.place)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: TokenSizes.spaceXs),
          child: Text(chapter.step.place, style: Theme.of(context).textTheme.bodySmall),
        ),
      ContentLanguageNote(contentLocale: view?.contentLocale ?? ContentLocale.ru, audioAvailable: chapter.audio != null),
      StoryView(content: chapter.content, contentLocale: view?.contentLocale ?? ContentLocale.ru),
    ]),
  );
}

/// «Настройки»: how stops switch and the speed of the story.
Future<void> showSettingsDrawer(BuildContext context, WalkPlayerController controller) => _sheet(
      context,
      (context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final state = controller.state;
          final theme = Theme.of(context);
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Semantics(header: true, child: Text(context.t('Настройки прогулки'), style: theme.textTheme.titleLarge)),
            const SizedBox(height: TokenSizes.spaceSm),
            Text(context.t('Переключение остановок'), style: theme.textTheme.titleSmall),
            const SizedBox(height: TokenSizes.spaceXs),
            SegmentedButton<AdvanceMode>(
              showSelectedIcon: false,
              segments: [
                for (final mode in AdvanceMode.values)
                  ButtonSegment(value: mode, label: Text(context.t(advanceModeLabels[mode]!), maxLines: 2, textAlign: TextAlign.center)),
              ],
              selected: {state.advance},
              onSelectionChanged: (selection) => controller.setAdvanceMode(selection.single),
            ),
            const SizedBox(height: TokenSizes.spaceXs),
            Text(context.t(advanceModeHints[state.advance]!), style: theme.textTheme.bodySmall),
            if (state.advance == AdvanceMode.place && state.effectiveAdvance != AdvanceMode.place)
              Padding(
                padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
                child: Semantics(
                  liveRegion: true,
                  child: Text(context.t(placeModeWarning), style: const TextStyle(color: TokenColors.warningInk)),
                ),
              ),
            const SizedBox(height: TokenSizes.spaceMd),
            Text(context.t('Скорость аудио'), style: theme.textTheme.titleSmall),
            const SizedBox(height: TokenSizes.spaceXs),
            Wrap(spacing: TokenSizes.spaceXs, children: [
              for (final rate in playbackRates)
                ChoiceChip(
                  label: Text(rateLabel(rate, context.appLocale)),
                  selected: rate == state.rate,
                  onSelected: (_) => controller.setRate(rate),
                ),
            ]),
          ]);
        },
      ),
    );

/// The status of the position source with what to do about it (site «position» drawer + GeoHelp).
Future<void> showPositionDrawer(BuildContext context, WalkPlayerController controller) => _sheet(
      context,
      (context) => ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final state = controller.state;
          final text = !state.positionFailed
              ? 'Определяем положение…'
              : state.positionDenied
                  ? 'Приложению запрещён доступ к геопозиции. Разрешите его в настройках телефона — до тех пор остановки переключаются вручную.'
                  : 'Не удалось определить положение. Проверьте, включена ли геолокация на устройстве, — до тех пор остановки переключаются вручную.';
          final theme = Theme.of(context);
          return Semantics(
            liveRegion: true,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(context.t(text)),
              if (state.positionFailed) ...[
                const SizedBox(height: TokenSizes.spaceSm),
                Text(context.t('Как разрешить геолокацию'), style: theme.textTheme.titleSmall),
                for (final (index, step) in const [
                  'Откройте «Настройки» телефона → «Приложения» → «Отголосок» → «Разрешения» → «Местоположение».',
                  'Выберите «Разрешить только во время использования приложения» и включите «Точное местоположение».',
                  'Проверьте, что геолокация включена в быстрых настройках телефона, и вернитесь в приложение.',
                ].indexed)
                  Padding(
                    padding: const EdgeInsets.only(top: TokenSizes.spaceXs),
                    child: Text('${index + 1}. ${context.t(step)}'),
                  ),
                const SizedBox(height: TokenSizes.spaceSm),
                Wrap(spacing: TokenSizes.spaceXs, children: [
                  FilledButton(onPressed: () => unawaited(controller.retryPosition()), child: Text(context.t('Проверить снова'))),
                  OutlinedButton(onPressed: () => unawaited(controller.openAppSettings()), child: Text(context.t('Открыть настройки'))),
                ]),
              ],
            ]),
          );
        },
      ),
    );

/// «Прервать прогулку?»: true only when the walker chose «Прервать».
Future<bool> confirmStopWalk(BuildContext context) async {
  final answer = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(context.t('Прервать прогулку?')),
      content: Text(context.t('Звук остановится, и вы вернётесь к описанию маршрута. Начать заново можно в любой момент.')),
      actions: [
        // The safe answer comes first.
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(context.t('Продолжить'))),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: TokenColors.dangerInk),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(context.t('Прервать')),
        ),
      ],
    ),
  );
  return answer ?? false;
}

/// The label of the walk's play button (site `audioButtonLabel`), a dictionary source string.
String walkAudioLabel(WalkUiState state) => switch (state.audioStatus) {
      WalkAudioStatus.loading => 'Отменить запуск',
      WalkAudioStatus.playing => 'Пауза',
      WalkAudioStatus.paused => 'Продолжить',
      WalkAudioStatus.ended => 'Слушать ещё раз',
      WalkAudioStatus.error => 'Повторить запуск звука',
      WalkAudioStatus.locked || WalkAudioStatus.ready => state.audioUrl != null ? 'Слушать историю' : 'Аудио ещё не готово',
    };
