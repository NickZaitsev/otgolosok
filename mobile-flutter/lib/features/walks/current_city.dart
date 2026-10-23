import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../walk_engine/cities.dart';

/// The city the listener chose last (site `current-city.ts`, `otgolosok:city:v1`); it filters the
/// trends. Moscow when nothing is stored or the stored id is unknown.
final currentCityProvider = NotifierProvider<CurrentCity, City>(CurrentCity.new);

class CurrentCity extends Notifier<City> {
  static const storageKey = 'city';

  @override
  City build() {
    final id = ref.watch(settingsProvider).readString(storageKey);
    return cities.where((city) => city.id == id).firstOrNull ?? cities.first;
  }

  /// Remembers the choice; a failed write still keeps it for this run.
  Future<void> choose(City city) async {
    if (city.id == state.id) return;
    state = city;
    await ref.read(settingsProvider).writeString(storageKey, city.id);
  }
}
