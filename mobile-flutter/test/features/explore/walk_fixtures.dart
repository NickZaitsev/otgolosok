import 'package:otgolosok/features/explore/walk_overview.dart';

/// A valid `/api/walks/map` item.
Map<String, Object?> walkJson(Map<String, Object?> overrides) => {
      'kind': 'catalog',
      'id': 'arbat',
      'title': 'Арбат',
      'distanceM': 2100,
      'walkingMinutes': 30,
      'stopCount': 6,
      'rating': {'average': 4.5, 'count': 2},
      'line': [
        [55.75, 37.59],
        [55.752, 37.6],
      ],
      ...overrides,
    };

/// A walk with a two-point line from [south],[west] to [north],[east].
MapWalk mapWalk(String id, {double south = 55.75, double west = 37.6, double north = 55.751, double east = 37.601}) =>
    validateMapWalks({
      'walks': [
        walkJson({
          'id': id,
          'line': [
            [south, west],
            [north, east],
          ],
        }),
      ],
    }).walks.single;
