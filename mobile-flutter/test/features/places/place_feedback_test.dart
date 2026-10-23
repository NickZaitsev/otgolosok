import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/feedback/improvement_model.dart';
import 'package:otgolosok/features/places/place_feedback.dart';

Map<String, Object?> _mine(Map<String, Object?> overrides) => {
      'mine': {'rating': -1, 'issues': <Object?>[], 'text': '', 'status': 'open', 'updatedAt': '2026-10-01T10:00:00.000Z', ...overrides},
    };

void main() {
  group('canRatePlace', () {
    const cases = {
      'osm:node:1': true,
      'osm:way:22': true,
      'osm:relation:333': true,
      'osm:area:1': false,
      'osm:node:': false,
      'mos:12': false,
      '': false,
    };
    cases.forEach((id, expected) => test(id.isEmpty ? '(empty)' : id, () => expect(canRatePlace(id), expected)));

    test('the feedback path refuses a place that cannot be rated', () {
      expect(placeFeedbackPath('osm:node:1'), '/api/content/places/osm:node:1/feedback/mine');
      expect(() => placeFeedbackPath('mos:12'), throwsArgumentError);
    });
  });

  group('validatePlaceFeedback', () {
    test('no vote yet', () => expect(validatePlaceFeedback({'mine': null}), isNull));

    test('a like', () {
      final feedback = validatePlaceFeedback(_mine({'rating': 1, 'status': 'resolved'}))!;
      expect(feedback.rating, 1);
      expect(feedback.status, PlaceFeedbackStatus.resolved);
      expect(feedback.issues, isEmpty);
    });

    test('a dislike keeps its text and lists issues in canonical order', () {
      final feedback = validatePlaceFeedback(_mine({'issues': ['voiceover', 'short_text'], 'text': 'Мало фактов'}))!;
      expect(feedback.rating, -1);
      expect(feedback.issues, [ImprovementIssue.shortText, ImprovementIssue.voiceover]);
      expect(feedback.text, 'Мало фактов');
    });

    test('text at the limit is accepted', () {
      expect(validatePlaceFeedback(_mine({'text': 'а' * placeFeedbackTextMax}))!.text, hasLength(placeFeedbackTextMax));
    });

    final invalid = <String, Object?>{
      'not an object': 'mine',
      'no mine field': <String, Object?>{},
      'mine is a list': {'mine': <Object?>[]},
      'zero rating': _mine({'rating': 0}),
      'rating as a string': _mine({'rating': '1'}),
      'unknown issue': _mine({'issues': ['typo']}),
      'repeated issue': _mine({'issues': ['voiceover', 'voiceover']}),
      'issues not a list': _mine({'issues': 'voiceover'}),
      'text over the limit': _mine({'text': 'а' * (placeFeedbackTextMax + 1)}),
      'a like with issues': _mine({'rating': 1, 'issues': ['no_images']}),
      'a like with text': _mine({'rating': 1, 'text': 'Хорошо'}),
      'unknown status': _mine({'status': 'deleted'}),
      'no update time': _mine({'updatedAt': null}),
    };
    invalid.forEach((name, value) => test(name, () => expect(() => validatePlaceFeedback(value), throwsFormatException)));
  });
}
