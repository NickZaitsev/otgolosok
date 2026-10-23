import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/reviews/review_model.dart';
import 'package:otgolosok/features/walks/launches.dart';

import 'support.dart';

void main() {
  test('only catalogue and link walks are counted', () {
    expect(launchesPath(const CatalogReviewTarget('arbat-test')), '/api/story-walks/arbat-test/launches');
    expect(launchesPath(const SharedReviewTarget('tok')), '/api/story-walks/shared/tok/launches');
    expect(launchesPath(const AccountReviewTarget('id-1')), isNull);
    expect(launchesPath(null), isNull);
  });

  test('a launch is reported once with the guest key, whatever the answer', () async {
    final adapter = FakeAdapter((_) => const Reply(500, {'error': {'message': 'Ошибка.'}}));
    final reporter = WalkLaunchReporter(fakeApi(adapter), const CatalogReviewTarget('arbat-test'));
    reporter();
    reporter();
    await pumpEventQueue();
    expect(reporter.sent, isTrue);
    final paths = adapter.requests.map((request) => request.uri.path).toSet();
    expect(paths, {'/api/story-walks/arbat-test/launches'});
    expect(adapter.requests.first.method, 'POST');
    expect(adapter.requests.first.headers['X-Review-Key'], 'k' * 43);
  });

  test('own walks send nothing', () async {
    final adapter = FakeAdapter((_) => throw StateError('no request expected'));
    final reporter = WalkLaunchReporter(fakeApi(adapter), const AccountReviewTarget('id-1'));
    reporter();
    await pumpEventQueue();
    expect(reporter.sent, isFalse);
    expect(adapter.requests, isEmpty);
  });

  test('the server answer is checked', () {
    expect(validateLaunch({'counted': false}), isFalse);
    expect(() => validateLaunch({'counted': 1}), throwsFormatException);
  });
}
