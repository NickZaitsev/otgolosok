// Port of `walkViewToRoute` (src/features/walks/adapters.ts): a validated walk
// view as the route the player walks.
import 'dart:math' as math;

import 'distance.dart';
import 'route.dart';
import 'walk_view.dart';

const StepTrigger _defaultTrigger = StepTrigger(
  enterM: 35,
  exitM: 60,
  minFixes: 3,
  maxAccuracyM: 50,
);

String _dateOnly(String? value) {
  if (value == null) return '';
  return value.length > 10 ? value.substring(0, 10) : value;
}

HistoricalContent _historical(WalkStory? story, int revision, ContentLocale locale) {
  final pending = switch (locale) {
    ContentLocale.en => 'Story is still being prepared',
    ContentLocale.zh => '故事仍在准备中',
    ContentLocale.ru => 'История ещё готовится',
  };
  final pendingNote = switch (locale) {
    ContentLocale.en => 'The story will become available after the sources are verified.',
    ContentLocale.zh => '资料来源核实后，故事将会开放。',
    ContentLocale.ru => 'История станет доступна после проверки источников.',
  };
  final editorialNote = switch (locale) {
    ContentLocale.en => 'Sources and facts are available in the stop card.',
    ContentLocale.zh => '可在停靠点卡片中查看资料来源和事实。',
    ContentLocale.ru => 'Источники и факты доступны в карточке остановки.',
  };
  if (story == null) {
    return HistoricalContent(
      story: StoryBody(
        opening: pending,
        durationSec: 0,
        durationIsEstimate: true,
        textStatus: TextStatus.draft,
        revision: revision,
        checkedAt: '',
        paragraphs: const [],
        audioUrl: null,
      ),
      sources: const [],
      facts: const [],
      editorialNote: pendingNote,
    );
  }
  final characters = story.paragraphs.fold<int>(0, (sum, item) => sum + item.text.length);
  final checkedAt = _dateOnly(story.checkedAt);
  return HistoricalContent(
    story: StoryBody(
      opening: story.title,
      // Math.round of a non-negative number: halves round up, as Dart's round does.
      durationSec: math.max(1, (characters / 12).round()),
      durationIsEstimate: true,
      textStatus: TextStatus.ready,
      revision: revision,
      checkedAt: checkedAt,
      paragraphs: [
        for (var index = 0; index < story.paragraphs.length; index += 1)
          StoryParagraph(
            id: '$revision-$index',
            text: story.paragraphs[index].text,
            factIds: story.paragraphs[index].factIds,
          ),
      ],
      audioUrl: null,
    ),
    sources: [
      for (final source in story.sources)
        StorySourceRef(
          id: source.id,
          title: source.title,
          url: source.url,
          publisher: source.publisher,
          checkedAt: checkedAt,
        ),
    ],
    facts: [
      for (final fact in story.facts)
        StoryFactRef(id: fact.id, claim: fact.claim, sourceIds: fact.sourceIds),
    ],
    editorialNote: editorialNote,
  );
}

/// The catalog place whose photo the stop shows. Walks saved before stops
/// carried placeId still have the place of a resolved OSM story.
String? _photoPlace(WalkStop stop, WalkStory? story) =>
    stop.placeId ??
    (stop.storyRef?.kind == StoryRefKind.osm && story != null ? stop.storyRef!.id : null);

/// A validated walk view (see [WalkView.fromJson]) as the route the player walks.
Route walkViewToRoute(WalkView view) {
  final document = view.document;
  final pois = <Poi>[];
  final steps = <WalkStep>[];
  for (var index = 0; index < document.stops.length; index += 1) {
    final stop = document.stops[index];
    final chapter = view.chapters[index];
    final content = _historical(chapter.story, view.revision, chapter.contentLocale);
    final title = chapter.story?.title ?? stop.place.address;
    pois.add(
      Poi(
        id: stop.id,
        name: title,
        eyebrow: stop.place.address,
        location: stop.place.location,
        viewpoint: stop.triggerLocation ?? stop.place.location,
        viewpointPending: stop.triggerLocation == null,
        trigger: _defaultTrigger,
        content: content,
      ),
    );
    final audio = chapter.audio;
    steps.add(
      WalkStep(
        id: stop.id,
        contentId: stop.id,
        title: title,
        place: stop.place.address,
        location: stop.place.location,
        transition: stop.transition,
        nextHint: stop.nextHint,
        durationSec: (audio?.durationSec ?? content.story.durationSec).ceil(),
        triggerLocation: stop.triggerLocation,
        trigger: _defaultTrigger,
        status: chapter.status,
        localization: chapter.localization,
        placeId: _photoPlace(stop, chapter.story),
        audio: audio == null
            ? null
            : StepAudio(
                url: audio.url,
                durationSec: audio.durationSec,
                sha256: audio.sha256,
                language: audio.language,
              ),
      ),
    );
  }

  final anchor =
      document.start ??
      (document.stops.isEmpty ? null : document.stops.first.place) ??
      const WalkPlace(address: 'Маршрут ещё не построен', location: GeoPoint(55.75, 37.61));
  final finish =
      document.destination ??
      (document.mode == WalkMode.loop
          ? anchor
          : (document.stops.isEmpty ? anchor : document.stops.last.place));
  final route = document.route;
  if (pois.isEmpty) {
    pois.add(
      Poi(
        id: '${document.id}-start',
        name: anchor.address,
        eyebrow: anchor.address,
        location: anchor.location,
        viewpoint: anchor.location,
        viewpointPending: true,
        trigger: _defaultTrigger,
        content: _historical(null, view.revision, view.locale),
      ),
    );
  }
  final localization = view.documentLocalization;
  return Route(
    id: document.id,
    title: document.title,
    subtitle: document.description,
    city: document.city,
    durationMin: route?.car?.totalMinutes.toDouble() ??
        route?.walkingMinutes ??
        document.minutes.toDouble(),
    distanceKm: route == null ? 0 : route.distanceM / 1000,
    poiCount: steps.length,
    status: route == null ? RouteStatus.draft : RouteStatus.published,
    requestedLocale: localization?.requestedLocale ?? view.requestedLocale,
    contentLocale: localization?.contentLocale,
    fallbackReason: localization?.fallbackReason,
    pois: pois,
    walk: WalkPlan(
      car: route?.car == null ? null : copyCarRoute(route!.car!),
      start: WalkEndpoint(address: anchor.address, location: anchor.location),
      finish: WalkEndpoint(address: finish.address, location: finish.location),
      distanceM: route?.distanceM ?? 0,
      walkingMin: route?.walkingMinutes ?? document.minutes.toDouble(),
      fieldChecked: document.fieldChecked,
      path: WalkPath(
        coordinates: route?.geometry ?? const [],
        provider: route?.attribution ?? '',
        costing: route?.car != null ? PathCosting.auto : PathCosting.pedestrian,
        tunnels: route?.tunnels,
      ),
      steps: steps,
    ),
  );
}
