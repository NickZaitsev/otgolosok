// The walk model the player works on: the parts of src/features/tour/types.ts
// (`Route`, `WalkPlan`, `WalkStep`, `Poi`, `HistoricalContent`) that universal
// walks use. Built from a walk view by `walkViewToRoute` (walk_route.dart).
import 'car_route.dart';
import 'distance.dart';
import 'walk_view.dart'
    show ChapterStatus, ContentLocale, FallbackReason, TunnelRange, WalkLocalization;

/// Arrival radii of a stop (`trigger` of a step or POI).
class StepTrigger {
  const StepTrigger({
    required this.enterM,
    required this.exitM,
    required this.minFixes,
    required this.maxAccuracyM,
  });

  final double enterM;
  final double exitM;
  final int minFixes;
  final double maxAccuracyM;
}

enum TextStatus { draft, ready }

class StoryParagraph {
  StoryParagraph({required this.id, required this.text, required List<String> factIds})
    : factIds = List.unmodifiable(factIds);

  final String id;
  final String text;
  final List<String> factIds;
}

class StoryBody {
  StoryBody({
    required this.opening,
    required this.durationSec,
    required this.durationIsEstimate,
    required this.textStatus,
    required this.revision,
    required this.checkedAt,
    required List<StoryParagraph> paragraphs,
    required this.audioUrl,
  }) : paragraphs = List.unmodifiable(paragraphs);

  final String opening;
  final int durationSec;
  final bool durationIsEstimate;
  final TextStatus textStatus;
  final int revision;

  /// `YYYY-MM-DD` or empty.
  final String checkedAt;
  final List<StoryParagraph> paragraphs;
  final String? audioUrl;
}

class StorySourceRef {
  const StorySourceRef({
    required this.id,
    required this.title,
    required this.url,
    required this.publisher,
    required this.checkedAt,
  });

  final String id;
  final String title;
  final String url;
  final String publisher;
  final String checkedAt;
}

class StoryFactRef {
  StoryFactRef({required this.id, required this.claim, required List<String> sourceIds})
    : sourceIds = List.unmodifiable(sourceIds);

  final String id;
  final String claim;

  /// Evidence of a verified walk-view fact: the sources that confirm it.
  final List<String> sourceIds;
}

class HistoricalContent {
  HistoricalContent({
    required this.story,
    required List<StorySourceRef> sources,
    required List<StoryFactRef> facts,
    required this.editorialNote,
  }) : sources = List.unmodifiable(sources),
       facts = List.unmodifiable(facts);

  final StoryBody story;
  final List<StorySourceRef> sources;
  final List<StoryFactRef> facts;
  final String editorialNote;
}

class Poi {
  const Poi({
    required this.id,
    required this.name,
    required this.eyebrow,
    required this.location,
    required this.viewpoint,
    required this.viewpointPending,
    required this.trigger,
    required this.content,
  });

  final String id;
  final String name;
  final String eyebrow;
  final GeoPoint location;
  final GeoPoint? viewpoint;
  final bool viewpointPending;
  final StepTrigger trigger;
  final HistoricalContent content;
}

class StepAudio {
  const StepAudio({required this.url, required this.durationSec, required this.sha256, this.language});

  final String url;
  final double durationSec;
  final String sha256;
  final ContentLocale? language;
}

class WalkStep {
  const WalkStep({
    required this.id,
    required this.contentId,
    required this.title,
    required this.place,
    required this.location,
    required this.transition,
    required this.nextHint,
    required this.durationSec,
    this.triggerLocation,
    this.trigger,
    this.placeId,
    this.status,
    this.localization,
    this.audio,
  });

  final String id;
  final String contentId;
  final String title;
  final String place;
  final GeoPoint location;
  final String transition;
  final String nextHint;
  final int durationSec;

  /// Where the walker has to be for this chapter to start, when that differs
  /// from the building it describes. The map pin stays on [location].
  final GeoPoint? triggerLocation;
  final StepTrigger? trigger;

  /// The published catalog place the stop tells about (its photo).
  final String? placeId;
  final ChapterStatus? status;
  final WalkLocalization? localization;
  final StepAudio? audio;

  WalkStep withHints({required String transition, required String nextHint}) => WalkStep(
    id: id,
    contentId: contentId,
    title: title,
    place: place,
    location: location,
    transition: transition,
    nextHint: nextHint,
    durationSec: durationSec,
    triggerLocation: triggerLocation,
    trigger: trigger,
    placeId: placeId,
    status: status,
    localization: localization,
    audio: audio,
  );
}

class WalkEndpoint {
  const WalkEndpoint({required this.address, required this.location});

  final String address;
  final GeoPoint location;
}

enum PathCosting { pedestrian, auto }

class WalkPath {
  WalkPath({
    required List<GeoPoint> coordinates,
    required this.provider,
    required this.costing,
    List<TunnelRange>? tunnels,
  }) : coordinates = List.unmodifiable(coordinates),
       tunnels = tunnels == null ? null : List.unmodifiable(tunnels);

  /// The routed line (stored as `[lon, lat]` pairs on the site).
  final List<GeoPoint> coordinates;
  final String provider;
  final PathCosting costing;
  final List<TunnelRange>? tunnels;
}

class WalkPlan {
  WalkPlan({
    required this.start,
    required this.finish,
    required this.distanceM,
    required this.walkingMin,
    required this.fieldChecked,
    required this.path,
    required List<WalkStep> steps,
    this.car,
  }) : steps = List.unmodifiable(steps);

  final CarRoute? car;
  final WalkEndpoint start;
  final WalkEndpoint finish;
  final double distanceM;
  final double walkingMin;
  final bool fieldChecked;
  final WalkPath path;
  final List<WalkStep> steps;
}

enum RouteStatus { draft, published }

class Route {
  Route({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.city,
    required this.durationMin,
    required this.distanceKm,
    required this.poiCount,
    required this.status,
    required List<Poi> pois,
    this.requestedLocale,
    this.contentLocale,
    this.fallbackReason,
    this.walk,
  }) : pois = List.unmodifiable(pois);

  final String id;
  final String title;
  final String subtitle;
  final String city;
  final double durationMin;
  final double distanceKm;
  final int poiCount;
  final RouteStatus status;
  final ContentLocale? requestedLocale;
  final ContentLocale? contentLocale;
  final FallbackReason? fallbackReason;

  /// Never empty: a walk without stops carries one placeholder POI at its start.
  final List<Poi> pois;
  final WalkPlan? walk;

  Route withWalk(WalkPlan? walk) => Route(
    id: id,
    title: title,
    subtitle: subtitle,
    city: city,
    durationMin: durationMin,
    distanceKm: distanceKm,
    poiCount: poiCount,
    status: status,
    pois: pois,
    requestedLocale: requestedLocale,
    contentLocale: contentLocale,
    fallbackReason: fallbackReason,
    walk: walk,
  );
}
