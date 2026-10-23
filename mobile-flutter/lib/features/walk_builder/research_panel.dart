import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/theme/tokens.g.dart';
import '../../core/i18n/i18n.dart';
import 'builder_controller.dart';
import 'messages.dart';
import 'model.dart';
import 'widgets.dart';

/// «Исследование района» (site research-panel.tsx).
class ResearchPanel extends StatelessWidget {
  const ResearchPanel({super.key, required this.controller, required this.disabled, required this.onOpen});

  final BuilderController controller;
  final bool disabled;

  /// Opens the walk page after the researched route was applied.
  final void Function(String location) onOpen;

  static const _phases = {
    ResearchPhase.discovery: 'Ищем адреса поблизости',
    ResearchPhase.research: 'Проверяем источники об адресах',
    ResearchPhase.routing: 'Соединяем подтверждённые остановки',
    ResearchPhase.narration: 'Готовим тексты и аудио',
    ResearchPhase.complete: 'Прогулка готова',
  };

  @override
  Widget build(BuildContext context) {
    final state = controller.research;
    if (!state.visible) return const SizedBox.shrink();
    final draft = controller.draft;
    final ref = draft.research;
    final offered = controller.researchOffered;
    final job = state.visibleJob;
    final matches = state.matches;
    final canStart = state.canStart;
    final error = state.error;
    final theme = Theme.of(context);
    return Section(
      key: const ValueKey('research'),
      children: [
        Text(context.t('Исследование района'), style: theme.textTheme.titleMedium),
        if (offered) Text(context.t('Можем найти и проверить истории ещё нескольких зданий рядом. Это займёт время, и прогулка может не получиться.')),
        if (ref != null)
          Text.rich(TextSpan(children: [
            TextSpan(text: '${context.t('Начало исследования:')} '),
            TextSpan(text: ref.request.start.address, style: const TextStyle(fontWeight: FontWeight.w600)),
            TextSpan(
              text: '. ${context.t('{minutes} мин пешком, {returnMode}.', {
                'minutes': ref.request.minutes,
                'returnMode': context.t(ref.request.mode == WalkMode.loop ? 'с возвращением' : 'без возвращения'),
              })}',
            ),
          ])),
        if (job != null)
          Semantics(
            liveRegion: true,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                context.t(job.stage.terminal && job.stage != GenerationStage.ready
                    ? 'Исследование остановлено'
                    : job.stage == GenerationStage.queued
                        ? 'Ждём своей очереди'
                        : _phases[job.phase]!),
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              if (job.progress.total > 0)
                Text(context.t('Проверено адресов: {checked} из {total}. С подтверждениями: {accepted}.', {
                  'checked': job.progress.checked,
                  'total': job.progress.total,
                  'accepted': job.progress.accepted,
                })),
              if (job.error case final failure?)
                Notice(text: ErrorText(ModelError(failure.message), 'Исследование остановлено.').resolve(context), alert: true),
            ]),
          )
        else if (ref != null && !state.missing)
          Text(context.t(ref.id != null
              ? 'Проверяем сохранённое исследование…'
              : 'Отправка сохранена. Можно проверить статус сейчас или при возвращении, без новой отправки.')),
        if (ref != null && ref.id == null) SecondaryButton(label: context.t('Проверить статус'), onPressed: state.checkStatus),
        if (error != null) Notice(text: error.resolve(context), alert: true),
        if (ref != null)
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            minTileHeight: TokenSizes.controlPrimaryMin,
            title: Text(context.t('Как продолжить позже')),
            children: [
              Text(context.t('Исследование продолжается после закрытия страницы. Вернитесь к прогулке из истории в этом браузере. Если сохранить черновик не удалось, скачайте его перед уходом.')),
              if (ref.id != null) Text(context.t('ID исследования: {id}', {'id': ref.id!}), style: TextStyle(color: TokenColors.muted)),
            ],
          ),
        if (ref != null && !matches && draft.researchApplied != true)
          Text(context.t('Параметры или остановки изменены. Сохранённое исследование остаётся доступно, но его маршрут нельзя применить к этой версии прогулки.')),
        if (canStart || (job?.canRetry ?? false)) ...[
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (canStart)
              PrimaryButton(label: context.t('Найти истории рядом'), onPressed: disabled ? null : () => state.submit(disabled: disabled)),
            if (job?.canRetry ?? false)
              SecondaryButton(label: context.t('Продолжить поиск'), onPressed: disabled ? null : () => state.submit(retry: true, disabled: disabled)),
          ]),
          Text(context.t('Адреса уйдут сервисам поиска и озвучки.'), style: TextStyle(color: TokenColors.muted)),
        ],
        if (job?.stage == GenerationStage.ready && draft.researchApplied != true) ...[
          Text(context.t('Применение сохранит готовый маршрут и ссылки на истории. Новые исследования, тексты или аудио при этом не заказываются.')),
          PrimaryButton(
            label: context.t('Использовать прогулку'),
            onPressed: disabled || !matches
                ? null
                : () async {
                    final location = await state.apply();
                    if (location != null) onOpen(location);
                  },
          ),
        ],
        if (draft.researchApplied == true)
          Text(context.t('Исследованная прогулка применена. Готовые истории находятся ниже; дополнительных заказов нет.')),
        SecondaryButton(
          label: context.t('Выбрать другое начало'),
          onPressed: controller.busyNow
              ? null
              : () {
                  controller.setTarget(BuilderTarget.start);
                  unawaited(controller.edit(const DraftChange()));
                },
        ),
      ],
    );
  }
}
