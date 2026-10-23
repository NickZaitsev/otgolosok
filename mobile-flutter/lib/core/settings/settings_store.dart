import 'package:shared_preferences/shared_preferences.dart';

import '../i18n/translations.dart';

/// How a walk moves to the next story (src/features/tour/walk-settings.ts).
/// The app defaults to [place] («По месту»); the site keeps `manual`.
enum AdvanceMode { manual, place, sequence }

/// Playback rates offered by the site.
const playbackRates = [0.8, 1.0, 1.25, 1.5];

/// Small preferences in `shared_preferences`; checkpoints and walk progress use their own keys
/// through [readString]/[writeString] so the engine stays free of Flutter imports.
class SettingsStore {
  SettingsStore(this._prefs);

  static Future<SettingsStore> open() async => SettingsStore(await SharedPreferences.getInstance());

  static const _locale = 'locale';
  static const _advance = 'walk.advance';
  static const _rate = 'walk.rate';
  static const _direction = 'walk.direction.';

  final SharedPreferences _prefs;

  AppLocale? get locale => AppLocale.parse(_prefs.getString(_locale));
  Future<void> setLocale(AppLocale locale) => _prefs.setString(_locale, locale.name);

  AdvanceMode get advanceMode => AdvanceMode.values.where((mode) => mode.name == _prefs.getString(_advance)).firstOrNull ?? AdvanceMode.place;
  Future<void> setAdvanceMode(AdvanceMode mode) => _prefs.setString(_advance, mode.name);

  double get rate {
    final stored = _prefs.getDouble(_rate);
    return playbackRates.contains(stored) ? stored! : 1.0;
  }

  Future<void> setRate(double rate) {
    if (!playbackRates.contains(rate)) throw ArgumentError.value(rate, 'rate');
    return _prefs.setDouble(_rate, rate);
  }

  /// Whether the walk [routeId] was last walked in reverse.
  bool reversed(String routeId) => _prefs.getString('$_direction$routeId') == 'reverse';
  Future<void> setReversed(String routeId, bool reverse) =>
      reverse ? _prefs.setString('$_direction$routeId', 'reverse') : _prefs.remove('$_direction$routeId');

  String? readString(String key) => _prefs.getString(key);
  Future<void> writeString(String key, String value) => _prefs.setString(key, value);
  Future<void> remove(String key) => _prefs.remove(key);
}
