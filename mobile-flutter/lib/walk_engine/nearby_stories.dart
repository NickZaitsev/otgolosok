// Port of nearbyRadiusForAccuracy and recommendNearbyStories of
// src/features/explore/nearby-stories.ts.
import 'collation.dart';
import 'distance.dart';
import 'json_read.dart' show jsRound;

const List<int> nearbyRadii = [100, 200, 300];

/// The smallest radius that covers the position error; null when the fix is
/// too coarse to look for stories nearby.
int? nearbyRadiusForAccuracy(double accuracyM) {
  for (final radius in nearbyRadii) {
    if (accuracyM <= radius) return radius;
  }
  return null;
}

class NearbyStory {
  const NearbyStory({
    required this.id,
    required this.title,
    required this.address,
    required this.location,
    required this.durationSec,
    required this.sourceCount,
    required this.factCount,
  });

  final String id;
  final String title;
  final String address;
  final GeoPoint location;
  final double durationSec;
  final int sourceCount;
  final int factCount;
}

class NearbyRecommendation {
  const NearbyRecommendation(this.story, this.distanceM, this.reason);

  final NearbyStory story;
  final double distanceM;

  /// Already translated through the [Translate] passed to [recommendNearbyStories].
  final String reason;
}

/// Translates a Russian source string and fills its `{name}` placeholders
/// (`translate(locale, source, values)` of the site).
typedef Translate = String Function(String source, Map<String, Object> values);

final RegExp _placeholder = RegExp(r'\{([a-zA-Z][a-zA-Z0-9_]*)\}');

/// Fills `{name}` placeholders; unknown names stay as they are.
String fillPlaceholders(String text, Map<String, Object> values) =>
    text.replaceAllMapped(_placeholder, (match) {
      final value = values[match.group(1)];
      return value == null ? match.group(0)! : '$value';
    });

/// The Russian text itself, for callers without a dictionary.
String russianSource(String source, Map<String, Object> values) =>
    fillPlaceholders(source, values);

const String bestStoryReason =
    'Лучший подтверждённый рассказ: {facts} фактов и {sources} источников.';
const String nearbyStoryReason = '{distance} м по прямой · готовая история.';

/// Up to three ready stories within [radiusM]: more verified facts first, then
/// more sources, then closer, then by title (Russian collation, see collation.dart).
List<NearbyRecommendation> recommendNearbyStories(
  GeoPoint center,
  int radiusM,
  List<NearbyStory> catalog, {
  Translate translate = russianSource,
}) {
  final candidates = [
    for (final story in catalog) (story: story, distanceM: distanceMeters(center, story.location)),
  ].where((item) => item.distanceM <= radiusM).toList();
  // Array.prototype.sort is stable; List.sort is not, so ties keep catalog order explicitly.
  final indexed = [for (var index = 0; index < candidates.length; index += 1) (index, candidates[index])];
  indexed.sort((left, right) {
    final a = left.$2;
    final b = right.$2;
    final facts = b.story.factCount - a.story.factCount;
    if (facts != 0) return facts;
    final sources = b.story.sourceCount - a.story.sourceCount;
    if (sources != 0) return sources;
    final distance = a.distanceM - b.distanceM;
    if (distance != 0) return distance < 0 ? -1 : 1;
    final title = compareRussian(a.story.title, b.story.title);
    if (title != 0) return title;
    return left.$1 - right.$1;
  });
  final top = indexed.take(3).map((item) => item.$2).toList();
  return [
    for (var index = 0; index < top.length; index += 1)
      NearbyRecommendation(
        top[index].story,
        top[index].distanceM,
        index == 0
            ? translate(bestStoryReason, {
                'facts': top[index].story.factCount,
                'sources': top[index].story.sourceCount,
              })
            : translate(nearbyStoryReason, {'distance': jsRound(top[index].distanceM)}),
      ),
  ];
}
