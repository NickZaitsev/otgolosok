import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/food/opening_hours.dart';
import 'package:otgolosok/walk_engine/nearby_stories.dart' show russianSource;

HoursStatus at(String? rule, String stamp) => openingHoursStatus(rule, DateTime.parse(stamp));
String russian(FoodText text) => text.resolve(russianSource);

void main() {
  group('status line', () {
    const cases = [
      ('24/7', '2026-10-05T23:00:00+03:00', 'Открыто круглосуточно'),
      ('Mo-Su 09:00-22:00', '2026-10-05T09:00:00+03:00', 'Открыто до 22:00'),
      ('Mo-Su 09:00-22:00', '2026-10-05T21:59:59+03:00', 'Открыто до 22:00'),
      ('Mo-Su 09:00-22:00', '2026-10-05T22:00:00+03:00', 'Закрыто, откроется завтра в 9:00'),
      ('Mo-Su 09:00-22:00', '2026-10-05T08:59:59+03:00', 'Закрыто, откроется в 9:00'),
      ('Mo-Fr,Su 09:00-22:00', '2026-10-10T12:00:00+03:00', 'Закрыто, откроется завтра в 9:00'),
      ('Sa,Su 09:00-22:00', '2026-10-05T12:00:00+03:00', 'Закрыто, откроется в сб 9:00'),
      ('00:00-02:00,07:00-24:00', '2026-10-05T01:00:00+03:00', 'Открыто до 02:00'),
      ('00:00-02:00,07:00-24:00', '2026-10-05T02:00:00+03:00', 'Закрыто, откроется в 7:00'),
      ('00:00-02:00,07:00-24:00', '2026-10-05T23:59:00+03:00', 'Открыто до 02:00'),
      ('Su 18:00-02:00', '2026-10-05T01:59:59+03:00', 'Открыто до 02:00'),
      ('Su 18:00-02:00', '2026-10-05T02:00:00+03:00', 'Закрыто, откроется в вс 18:00'),
      ('Mo 18:00-02:00', '2026-10-06T01:00:00+03:00', 'Открыто до 02:00'),
      ('Mo-Su 00:00-24:00', '2026-10-05T12:00:00+03:00', 'Открыто круглосуточно'),
      ('Mo-Su 10:00-24:00', '2026-10-05T12:00:00+03:00', 'Открыто до полуночи'),
      ('Mo-Su 09:00-22:00; Mo 10:00-12:00', '2026-10-05T13:00:00+03:00', 'Закрыто, откроется завтра в 9:00'),
      ('24/7; Sa-Su off', '2026-10-11T12:00:00+03:00', 'Закрыто, откроется завтра в 0:00'),
      ('Mo-Su 18:00-02:00; Tu closed', '2026-10-06T01:00:00+03:00', 'Закрыто, откроется завтра в 18:00'),
      ('Mo 09:00-10:00; Mo off', '2026-10-05T09:30:00+03:00', 'Закрыто'),
      ('Mo off; Mo 09:00-10:00', '2026-10-05T09:30:00+03:00', 'Открыто до 10:00'),
      ('Su-Th 12:00-24:00, Fr,Sa 12:00-02:00', '2026-10-10T01:00:00+03:00', 'Открыто до 02:00'),
      ('Mo-Su 8:00-22:00', '2026-10-05T08:00:00+03:00', 'Открыто до 22:00'),
      ('Mo-Su 00:00-00:00', '2026-10-05T12:00:00+03:00', 'Открыто круглосуточно'),
      ('Mo-Fr 07:00-23:00; Sa, Su 08:00-22:00', '2026-10-10T08:00:00+03:00', 'Открыто до 22:00'),
      ('closed', '2026-10-05T08:00:00+03:00', 'Закрыто'),
      ('off', '2026-10-05T08:00:00+03:00', 'Закрыто'),
      // Boundary: Sunday 23:59 wraps to Monday of the next week.
      ('Mo 09:00-10:00', '2026-10-11T23:59:00+03:00', 'Закрыто, откроется завтра в 9:00'),
      ('Fr-Mo 10:00-11:00', '2026-10-06T12:00:00+03:00', 'Закрыто, откроется в пт 10:00'),
    ];
    for (final (rule, stamp, label) in cases) {
      test('$rule at $stamp', () => expect(russian(formatHoursStatus(at(rule, stamp))), label));
    }
  });

  group('unknown', () {
    const rules = [
      null, '', '   ', 'PH off', 'week 01-10 Mo 09:00-22:00', 'sunrise-sunset', 'Jan-Mar 10:00-22:00', 'Mo 10:00-22:00 "comment"', 'Mo 25:00-26:00', //
      'Mo 24:00-02:00', 'Mo 09:60-10:00', 'Mo 10:00-10:00', 'Mo-Su,PH 10:00-22:00', '24/7;', 'nonsense', 'Mo 10:00-24:01',
    ];
    for (final rule in rules) {
      test('for ${rule == null ? 'null' : '"$rule"'}', () {
        final result = openingHoursStatus(rule, DateTime.utc(2026, 10, 5, 12));
        expect(result.state, HoursState.unknown);
        expect(russian(formatHoursStatus(result)), 'Часы не указаны');
        expect(result.until, isNull);
        expect(parseOpeningHours(rule), isNull);
      });
    }
  });

  test('ignores PH off with a separate caveat', () {
    final result = at('Mo-Su 09:00-22:00; PH off', '2026-10-05T12:00:00+03:00');
    expect(result, const HoursStatus(state: HoursState.open, holidayCaveat: true, until: '22:00'));
    expect(russian(formatHolidayCaveat(result)!), 'В праздники часы работы могут отличаться');
    expect(formatHolidayCaveat(at('24/7', '2026-10-05T12:00:00Z')), isNull);
    // An unparsable schedule still reports the holiday caveat.
    expect(at('sunrise-sunset; PH off', '2026-10-05T12:00:00Z').holidayCaveat, isTrue);
  });

  for (final stamp in ['2026-10-05T08:00:00Z', '2026-10-05T01:00:00-07:00', '2026-10-05T17:00:00+09:00']) {
    test('uses Moscow for the same instant expressed as $stamp', () {
      expect(at('10:00-12:00', stamp), const HoursStatus(state: HoursState.open, holidayCaveat: false, until: '12:00'));
    });
  }

  test('a device-local DateTime is evaluated by its instant, not its wall clock', () {
    final utc = DateTime.utc(2026, 10, 5, 8);
    expect(openingHoursStatus('10:00-12:00', utc.toLocal()), openingHoursStatus('10:00-12:00', utc));
  });

  test('returns the next opening within a week with structured day and time', () {
    expect(at('Mo 09:00-10:00', '2026-10-05T10:00:00+03:00').opensAt, const OpensAt(day: 'пн', time: '09:00', daysAhead: 7));
    expect(parseOpeningHours('Mo-Fr,Su 09:00-22:00')?.minutes.length, 10080);
    expect(at('Mo-Su off', '2026-10-05T10:00:00+03:00'), const HoursStatus(state: HoursState.closed, holidayCaveat: false));
  });

  test('formats open and next-opening states in English and simplified Chinese, translating the day name', () {
    final site = Translations.parse(File('assets/i18n/translations.json').readAsStringSync());
    final open = formatHoursStatus(at('Mo-Su 09:00-22:00', '2026-10-05T12:00:00+03:00'));
    final weekend = formatHoursStatus(at('Sa,Su 09:00-22:00', '2026-10-05T12:00:00+03:00'));
    expect(open.resolve((source, values) => site.translate(AppLocale.en, source, values)), 'Open until 22:00');
    expect(weekend.resolve((source, values) => site.translate(AppLocale.zh, source, values)), '已打烊，周六 9:00 开门');
    expect(weekend, const FoodText('Закрыто, откроется в {day} {time}', {'day': FoodText('сб'), 'time': '9:00'}));
  });

  group('FoodHoursCache', () {
    test('parses an equal string once and changes the status at the minute boundary', () {
      var parses = 0;
      final hours = FoodHoursCache(parse: (value) {
        parses += 1;
        return parseOpeningHours(value);
      });
      final before = DateTime.utc(2026, 10, 4, 18, 59), after = DateTime.utc(2026, 10, 4, 19);
      expect(hours.status('Mo-Su 09:00-22:00', before), const HoursStatus(state: HoursState.open, holidayCaveat: false, until: '22:00'));
      expect(hours.status('Mo-Su 09:00-22:00', before).state, HoursState.open);
      final closed = hours.status('Mo-Su 09:00-22:00', after);
      expect(closed.state, HoursState.closed);
      expect((closed.opensAt?.time, closed.opensAt?.daysAhead), ('09:00', 1));
      expect(parses, 1);
    });

    for (final value in [null, 'sunrise-sunset', '']) {
      test('caches an unknown rule ${value == null ? 'null' : '"$value"'} as well', () {
        var parses = 0;
        final hours = FoodHoursCache(parse: (value) {
          parses += 1;
          return parseOpeningHours(value);
        });
        final now = DateTime.utc(2026, 10, 4, 12);
        expect(hours.status(value, now).state, HoursState.unknown);
        expect(hours.status(value, now).state, HoursState.unknown);
        expect(parses, 1);
      });
    }

    test('keeps different strings apart and preserves the holiday caveat', () {
      final hours = FoodHoursCache(), now = DateTime.utc(2026, 10, 4, 12);
      final open = hours.status('24/7; PH off', now);
      expect((open.state, open.holidayCaveat, open.roundTheClock), (HoursState.open, true, true));
      expect(hours.status('Mo-Su off', now), const HoursStatus(state: HoursState.closed, holidayCaveat: false));
    });
  });
}
