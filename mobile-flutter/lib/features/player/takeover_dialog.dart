import 'package:flutter/material.dart';

import '../../core/i18n/i18n.dart';
import 'walk_service_hub.dart';

/// One recording plays at a time: asks before something else replaces what [current] plays.
/// Resolves true only when the user agreed.
Future<bool> confirmTakeover(BuildContext context, {required SessionOwnerKind current}) async {
  final story = current == SessionOwnerKind.story;
  final title = story ? context.t('Остановить историю?') : context.t('Прервать прогулку?');
  final text = story
      ? context.t('Одновременно звучит только одна запись. История остановится.')
      : context.t('Одновременно звучит только одна запись. Прогулка остановится, место в ней сохранится.');
  final answer = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(text),
      actions: [
        // The safe answer comes first, as in «Прервать прогулку?» on the site.
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(context.t('Отмена'))),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(story ? context.t('Остановить') : context.t('Прервать')),
        ),
      ],
    ),
  );
  return answer ?? false;
}
