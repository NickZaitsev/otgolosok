// Port of src/features/tour/walk-settings.ts (without the React store).
import 'dart:convert';

/// How the next chapter starts.
enum AdvanceMode {
  /// «По кнопке»: the «Дальше» button or the lock screen.
  manual,

  /// «По месту»: arriving at the stop starts its story. Needs location access.
  place,

  /// «Подряд»: chapters play one after another.
  sequence,
}

const Map<AdvanceMode, String> advanceModeLabels = {
  AdvanceMode.manual: 'По кнопке',
  AdvanceMode.place: 'По месту',
  AdvanceMode.sequence: 'Подряд',
};

const Map<AdvanceMode, String> advanceModeHints = {
  AdvanceMode.manual: 'Следующая часть включается кнопкой «Дальше» или с экрана блокировки.',
  AdvanceMode.place: 'Часть включится сама, когда вы дойдёте до её дома. Нужен доступ к геолокации.',
  AdvanceMode.sequence: 'Части идут одна за другой без пауз. Удобно дома, на ходу можно отстать от рассказа.',
};

const List<double> playbackRates = [0.8, 1, 1.25, 1.5];

class WalkSettings {
  const WalkSettings({required this.advance, required this.rate});

  final AdvanceMode advance;
  final double rate;

  WalkSettings copyWith({AdvanceMode? advance, double? rate}) =>
      WalkSettings(advance: advance ?? this.advance, rate: rate ?? this.rate);

  String serialize() => jsonEncode({'advance': advance.name, 'rate': rate});

  @override
  bool operator ==(Object other) =>
      other is WalkSettings && other.advance == advance && other.rate == rate;

  @override
  int get hashCode => Object.hash(advance, rate);
}

/// The app starts walks «По месту»: the phone stays locked in a pocket and the
/// walk service keeps location alive. The site defaults to «По кнопке» until
/// its first walk is checked on the ground (walk-settings.ts).
const WalkSettings defaultWalkSettings = WalkSettings(advance: AdvanceMode.place, rate: 1);

const String walkSettingsKey = 'otgolosok:walk-settings';

WalkSettings parseWalkSettings(String? raw) {
  if (raw == null || raw.isEmpty || raw.length > 512) return defaultWalkSettings;
  final Object? saved;
  try {
    saved = jsonDecode(raw);
  } on FormatException {
    return defaultWalkSettings;
  }
  if (saved is! Map<String, Object?>) return defaultWalkSettings;
  final savedAdvance = saved['advance'];
  final advance = AdvanceMode.values.where((mode) => mode.name == savedAdvance);
  final rate = saved['rate'];
  return WalkSettings(
    advance: advance.isEmpty ? defaultWalkSettings.advance : advance.first,
    rate: rate is num && playbackRates.contains(rate) ? rate.toDouble() : defaultWalkSettings.rate,
  );
}
