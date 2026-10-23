import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/walk_builder/throttle.dart';

import 'support.dart';

void main() {
  const interval = Duration(milliseconds: 1100);

  test('tasks started together run one by one, at least the interval apart', () async {
    final clock = FakeClock();
    final throttle = RequestThrottle(interval, clock);
    final starts = <DateTime>[];
    final results = await Future.wait([
      for (var index = 0; index < 3; index++)
        throttle.run(() async {
          starts.add(clock.now());
          return index;
        }),
    ]);
    expect(results, [0, 1, 2]);
    expect(starts[1].difference(starts[0]), interval);
    expect(starts[2].difference(starts[1]), interval);
  });

  test('a task that took longer than the interval does not delay the next one', () async {
    final clock = FakeClock();
    final throttle = RequestThrottle(interval, clock);
    await throttle.run(() async => clock.advance(const Duration(seconds: 3)));
    await throttle.run(() async {});
    expect(clock.sleeps, isEmpty);
  });

  test('a late call waits only for the rest of the interval', () async {
    final clock = FakeClock();
    final throttle = RequestThrottle(interval, clock);
    await throttle.run(() async {});
    clock.advance(const Duration(milliseconds: 400));
    await throttle.run(() async {});
    expect(clock.sleeps, [const Duration(milliseconds: 700)]);
  });

  test('a failed task does not block the queue and its error reaches the caller', () async {
    final clock = FakeClock();
    final throttle = RequestThrottle(interval, clock);
    final failed = throttle.run<int>(() async => throw StateError('boom'));
    final next = throttle.run(() async => 2);
    await expectLater(failed, throwsStateError);
    expect(await next, 2);
    expect(clock.sleeps, [interval]);
  });
}
