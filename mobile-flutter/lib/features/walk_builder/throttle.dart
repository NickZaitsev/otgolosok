import 'dart:async';

/// Time as the builder sees it; tests replace it with a fake that advances on demand.
abstract interface class Clock {
  DateTime now();

  Future<void> sleep(Duration duration);
}

class SystemClock implements Clock {
  const SystemClock();

  @override
  DateTime now() => DateTime.now();

  @override
  Future<void> sleep(Duration duration) => Future<void>.delayed(duration);
}

/// Runs tasks one at a time and starts each at least [interval] after the previous one started.
///
/// The server limits address lookups (1.1 s) and route planning (2 s) per client; spacing the
/// requests here keeps the app from tripping those limits by itself.
class RequestThrottle {
  RequestThrottle(this.interval, [this.clock = const SystemClock()]);

  final Duration interval;
  final Clock clock;
  Future<void> _tail = Future<void>.value();
  DateTime? _lastStart;

  Future<T> run<T>(Future<T> Function() task) {
    final previous = _tail;
    final done = Completer<void>();
    _tail = done.future;
    Future<T> start() async {
      await previous;
      final last = _lastStart;
      if (last != null) {
        final wait = last.add(interval).difference(clock.now());
        if (wait > Duration.zero) await clock.sleep(wait);
      }
      _lastStart = clock.now();
      return task();
    }

    return start().whenComplete(done.complete);
  }
}
