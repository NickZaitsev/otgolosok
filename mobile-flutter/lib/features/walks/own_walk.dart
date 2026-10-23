import 'package:flutter/widgets.dart';

import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../../walk_engine/js_json.dart';
import '../../walk_engine/walk_view.dart';
import '../walk_builder/model.dart' show routeShortfall;
import 'format.dart';
import 'walk_link.dart';

/// The builder of a walk saved on this device (`local`) or in the viewer's account (`id`); null
/// for walks of others, which never lead back to the builder (site `ownWalkEditHref`).
String? ownWalkEditLocation(WalkLink link) => switch (link) {
      LocalWalkLink(:final id) => Uri(path: '/builder', queryParameters: {'local': id, 'edit': '1'}).toString(),
      AccountWalkLink(:final id) => Uri(path: '/builder', queryParameters: {'id': id, 'edit': '1'}).toString(),
      _ => null,
    };

/// Builder results the walk page keeps showing: a short automatic walk and stops without a story
/// (site `ownWalkNotes`).
List<String> ownWalkNotes(BuildContext context, WalkView view) {
  final document = view.document;
  final route = document.route;
  final notes = <String>[];
  final shortfall = route != null && document.destination == null ? routeShortfall(route.walkingMinutes, document.minutes) : null;
  if (shortfall != null) {
    notes.add(context.t('Рядом нашлось мест только на {shortfall} мин из {minutes}. Измените начало прогулки.',
        {'shortfall': jsNumberToString(shortfall), 'minutes': document.minutes}));
  }
  final missing = view.chapters.where((chapter) => chapter.status == ChapterStatus.notRequested).length;
  if (missing > 0) {
    final locale = context.appLocale;
    final singular = locale == AppLocale.ru ? ruPlural(missing) == RuPlural.one : locale == AppLocale.en && missing == 1;
    notes.add(singular
        ? context.t('У {count} остановки пока нет истории.', {'count': missing})
        : context.t('У {count} остановок пока нет истории.', {'count': missing}));
  }
  return notes;
}
