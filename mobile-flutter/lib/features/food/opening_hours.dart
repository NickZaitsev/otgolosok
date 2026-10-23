// Port of src/features/food/opening-hours.ts and `createFoodHoursCache` of food-walk-model.ts: a conservative
// weekly subset of the OSM `opening_hours` syntax and the open/closed status shown on a food place.
import 'package:flutter/foundation.dart';

import '../../walk_engine/nearby_stories.dart' show Translate;

const _days = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/// Russian short day names; each one is itself a source string of the dictionary.
const _ruDays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const _dayMinutes = 1440, _weekMinutes = 7 * _dayMinutes;

/// Moscow has been UTC+3 all year round since 26 October 2014, so a fixed offset gives its wall clock without a
/// time zone database and independently of the device time zone.
const _moscowOffset = Duration(hours: 3);

final _timeValue = RegExp(r'^(\d{1,2}):([0-5]\d)$');
final _dayRange = RegExp(r'^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$');
// OSM also separates day-qualified rules with a comma instead of a semicolon.
final _commaRule = RegExp(r'(\d{1,2}:[0-5]\d|off|closed)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)[\w,\-]*\s+(?:\d|off\b|closed\b))');
final _spacedDays = RegExp(r',\s+(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)');
final _rule = RegExp(r'^(?:([A-Za-z,\-]+)\s+)?(.+)$');
final _span = RegExp(r'^(\d{1,2}:[0-5]\d)-(\d{1,2}:[0-5]\d)$');
final _holidayOff = RegExp(r'(?:^|;)\s*PH off\s*(?:;|$)');
final _leadingZero = RegExp(r'^0(?=\d)');

/// A text kept as its Russian source string and placeholder values, translated when drawn (`context.t`).
///
/// A value may itself be a [FoodText] (the day name of «Закрыто, откроется в {day} {time}»): [resolve] translates
/// such nested values first, so the widget calls `text.resolve(context.t)` and never handles them itself.
@immutable
class FoodText {
  const FoodText(this.source, [this.values = const {}]);

  final String source;
  final Map<String, Object> values;

  String resolve(Translate translate) => translate(source, {
        for (final MapEntry(:key, :value) in values.entries) key: value is FoodText ? value.resolve(translate) : value,
      });

  @override
  bool operator ==(Object other) => other is FoodText && other.source == source && mapEquals(other.values, values);

  @override
  int get hashCode => Object.hash(source, Object.hashAllUnordered(values.entries.map((entry) => Object.hash(entry.key, entry.value))));

  @override
  String toString() => 'FoodText($source, $values)';
}

/// The minutes of a week, Monday 00:00 first, with 1 where the place is open.
@immutable
class ParsedHours {
  const ParsedHours(this.minutes, {required this.holidayCaveat});

  final Uint8List minutes;
  final bool holidayCaveat;
}

enum HoursState { open, closed, unknown }

/// When a closed place opens next: [day] is the Russian short day name, [time] is `HH:MM`, [daysAhead] counts
/// from today (7 is the same weekday next week).
@immutable
class OpensAt {
  const OpensAt({required this.day, required this.time, required this.daysAhead});

  final String day;
  final String time;
  final int daysAhead;

  @override
  bool operator ==(Object other) => other is OpensAt && other.day == day && other.time == time && other.daysAhead == daysAhead;

  @override
  int get hashCode => Object.hash(day, time, daysAhead);

  @override
  String toString() => 'OpensAt($day $time, +$daysAhead)';
}

@immutable
class HoursStatus {
  const HoursStatus({required this.state, required this.holidayCaveat, this.until, this.roundTheClock = false, this.opensAt});

  final HoursState state;

  /// The rules say `PH off`: hours on public holidays may differ from the weekly schedule.
  final bool holidayCaveat;

  /// `HH:MM` when an open place closes; `00:00` is midnight.
  final String? until;
  final bool roundTheClock;
  final OpensAt? opensAt;

  @override
  bool operator ==(Object other) =>
      other is HoursStatus &&
      other.state == state &&
      other.holidayCaveat == holidayCaveat &&
      other.until == until &&
      other.roundTheClock == roundTheClock &&
      other.opensAt == opensAt;

  @override
  int get hashCode => Object.hash(state, holidayCaveat, until, roundTheClock, opensAt);

  @override
  String toString() => 'HoursStatus(${state.name}, holidayCaveat: $holidayCaveat, until: $until, roundTheClock: $roundTheClock, opensAt: $opensAt)';
}

String _clock(int minute) => '${(minute ~/ 60 % 24).toString().padLeft(2, '0')}:${(minute % 60).toString().padLeft(2, '0')}';

int? _time(String value, {required bool end}) {
  final match = _timeValue.firstMatch(value);
  if (match == null) return null;
  final hour = int.parse(match[1]!), minute = int.parse(match[2]!);
  return hour < 24 || end && hour == 24 && minute == 0 ? hour * 60 + minute : null;
}

List<int>? _selectedDays(String value) {
  final selected = <int>{};
  for (final part in value.split(',')) {
    final match = _dayRange.firstMatch(part);
    if (match == null) return null;
    final first = _days.indexOf(match[1]!), last = _days.indexOf(match[2] ?? match[1]!);
    for (var day = first;; day = (day + 1) % 7) {
      selected.add(day);
      if (day == last) break;
    }
  }
  return selected.toList();
}

/// Conservative weekly subset. Unsupported fragments invalidate the whole expression.
ParsedHours? parseOpeningHours(String? value) {
  if (value == null || value.trim().isEmpty) return null;
  final minutes = Uint8List(_weekMinutes);
  final schedule = List.generate(7, (_) => (order: -1, intervals: const <(int, int)>[]));
  var order = 0;
  var holidayCaveat = false, hasSchedule = false;
  final rules = value.trim().replaceAllMapped(_commaRule, (match) => '${match[1]};').replaceAll(_spacedDays, ',').split(';');
  for (final raw in rules) {
    final rule = raw.trim();
    if (rule == 'PH off') {
      holidayCaveat = true;
      continue;
    }
    if (rule == '24/7') {
      for (var day = 0; day < 7; day++) {
        schedule[day] = (order: order, intervals: const [(0, _dayMinutes)]);
      }
      order += 1;
      hasSchedule = true;
      continue;
    }
    final match = _rule.firstMatch(rule);
    if (match == null) return null;
    final selected = match[1] != null ? _selectedDays(match[1]!) : const [0, 1, 2, 3, 4, 5, 6];
    if (selected == null) return null;
    final intervals = <(int, int)>[];
    final hours = match[2]!;
    if (hours != 'off' && hours != 'closed') {
      for (final span in hours.split(',')) {
        final range = _span.firstMatch(span.trim());
        if (range == null) return null;
        final start = _time(range[1]!, end: false), end = _time(range[2]!, end: true);
        if (start == null || end == null || start == end && start != 0) return null;
        intervals.add((start, end <= start ? end + _dayMinutes : end));
      }
    }
    for (final day in selected) {
      schedule[day] = (order: order, intervals: intervals);
    }
    order += 1;
    hasSchedule = true;
  }
  for (var day = 0; day < 7; day++) {
    for (final (start, end) in schedule[day].intervals) {
      for (var m = start; m < end; m++) {
        // A later next-day override also overrides the inherited overnight tail.
        if (m >= _dayMinutes && schedule[(day + 1) % 7].order > schedule[day].order) continue;
        minutes[(day * _dayMinutes + m) % _weekMinutes] = 1;
      }
    }
  }
  return hasSchedule ? ParsedHours(minutes, holidayCaveat: holidayCaveat) : null;
}

/// The status at [now] on the Moscow wall clock, whatever the device time zone.
HoursStatus openingHoursStatus(String? value, DateTime now) => parsedOpeningHoursStatus(parseOpeningHours(value), value, now);

/// Evaluate a cached weekly schedule without allocating another minute table.
HoursStatus parsedOpeningHoursStatus(ParsedHours? parsed, String? value, DateTime now) {
  final holidayCaveat = parsed?.holidayCaveat ?? _holidayOff.hasMatch(value ?? '');
  if (parsed == null) return HoursStatus(state: HoursState.unknown, holidayCaveat: holidayCaveat);
  // `toUtc()` drops the device offset; the fixed Moscow offset then gives the Moscow wall clock in UTC fields.
  final moscow = now.toUtc().add(_moscowOffset);
  final day = moscow.weekday - DateTime.monday;
  final minute = moscow.hour * 60 + moscow.minute, index = day * _dayMinutes + minute;
  if (parsed.minutes[index] == 1) {
    var step = 1;
    while (step < _weekMinutes && parsed.minutes[(index + step) % _weekMinutes] == 1) {
      step += 1;
    }
    return step == _weekMinutes
        ? HoursStatus(state: HoursState.open, holidayCaveat: holidayCaveat, roundTheClock: true)
        : HoursStatus(state: HoursState.open, holidayCaveat: holidayCaveat, until: _clock((index + step) % _dayMinutes));
  }
  for (var step = 1; step <= _weekMinutes; step++) {
    if (parsed.minutes[(index + step) % _weekMinutes] == 0) continue;
    final daysAhead = (minute + step) ~/ _dayMinutes;
    final opensAt = OpensAt(day: _ruDays[(day + daysAhead) % 7], time: _clock((minute + step) % _dayMinutes), daysAhead: daysAhead);
    return HoursStatus(state: HoursState.closed, holidayCaveat: holidayCaveat, opensAt: opensAt);
  }
  return HoursStatus(state: HoursState.closed, holidayCaveat: holidayCaveat);
}

/// The status line of a place. For «Закрыто, откроется в {day} {time}» the `day` value is a nested [FoodText]
/// (`пн`…`вс`), translated by [FoodText.resolve].
FoodText formatHoursStatus(HoursStatus status) {
  switch (status.state) {
    case HoursState.unknown:
      return const FoodText('Часы не указаны');
    case HoursState.open:
      if (status.roundTheClock) return const FoodText('Открыто круглосуточно');
      return status.until == '00:00' ? const FoodText('Открыто до полуночи') : FoodText('Открыто до {time}', {'time': status.until!});
    case HoursState.closed:
      final opensAt = status.opensAt;
      if (opensAt == null) return const FoodText('Закрыто');
      final at = opensAt.time.replaceFirst(_leadingZero, '');
      if (opensAt.daysAhead == 0) return FoodText('Закрыто, откроется в {time}', {'time': at});
      if (opensAt.daysAhead == 1) return FoodText('Закрыто, откроется завтра в {time}', {'time': at});
      return FoodText('Закрыто, откроется в {day} {time}', {'day': FoodText(opensAt.day), 'time': at});
  }
}

FoodText? formatHolidayCaveat(HoursStatus status) => status.holidayCaveat ? const FoodText('В праздники часы работы могут отличаться') : null;

/// Scoped to the mounted screen: equal OSM strings share one minute table, including unknown strings.
class FoodHoursCache {
  /// [parse] is replaceable only to observe memoisation in tests.
  FoodHoursCache({this.parse = parseOpeningHours});

  final ParsedHours? Function(String? value) parse;
  final _schedules = <String?, ParsedHours?>{};

  HoursStatus status(String? value, DateTime now) => parsedOpeningHoursStatus(_schedules.putIfAbsent(value, () => parse(value)), value, now);
}
