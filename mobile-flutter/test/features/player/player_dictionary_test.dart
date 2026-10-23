import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/player/car/car_walk_panel.dart';
import 'package:otgolosok/features/player/service_errors.dart';
import 'package:otgolosok/features/player/story_listen.dart';
import 'package:otgolosok/features/player/story_view.dart';
import 'package:otgolosok/features/player/walk_drawers.dart';
import 'package:otgolosok/walk_engine/walk_settings.dart';
import 'package:otgolosok/walk_engine/walk_view.dart' show ContentLocale;

import '../auth/harness.dart' show loadTranslations;

/// Texts the player keeps in variables and translates only when shown: a missing dictionary
/// entry would silently stay Russian in the English and Chinese interface.
void main() {
  final translations = loadTranslations();

  final texts = <String>{
    ...WalkServiceMessages.all,
    StoryListenController.walkRunning,
    placeModeWarning,
    for (final fee in [true, false, null]) parkingFeeLabel(fee),
    for (final interface in AppLocale.values)
      for (final content in ContentLocale.values)
        for (final audio in [true, false]) ?contentLanguageNote(interface, content, audioAvailable: audio),
    ...advanceModeLabels.values,
    ...advanceModeHints.values,
  };

  test('the texts kept in variables are all there', () {
    // Every interface case is reached: all three content notes and all three parking labels.
    expect(texts, containsAll(<String>[
      'Текст и аудио этой истории пока доступны только на русском языке.',
      'Текст этой истории пока доступен только на русском языке. Озвучка готовится.',
      'Озвучка этой истории на выбранном языке ещё готовится.',
      'Плата за парковку неизвестна',
    ]));
  });

  for (final text in texts) {
    test('«$text» is translated', () {
      expect(translations.has(text), isTrue);
      expect(translations.translate(AppLocale.en, text), isNot(text));
    });
  }
}
