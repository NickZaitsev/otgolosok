import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/walk_builder/model.dart';
import 'package:otgolosok/features/walk_builder/walk_document.dart';
import 'package:otgolosok/walk_engine/distance.dart';

Map<String, Object?> _fixture(String name) => jsonDecode(File('test/fixtures/api/$name').readAsStringSync()) as Map<String, Object?>;

List<Map<String, Object?>> _cases(Map<String, Object?> fixture, String key) => (fixture[key]! as List<Object?>).cast<Map<String, Object?>>();

Place _place(String address, double lat, double lon) => Place(address: address, location: GeoPoint(lat, lon));

void main() {
  final builder = _fixture('walk_builder.json');

  group('plans agree with the site validator', () {
    for (final item in _cases(builder, 'plans')) {
      test('${item['name']}', () => expect(isPlan(item['input']), item['valid']));
    }
  });

  group('drafts agree with parseDraft', () {
    for (final item in _cases(builder, 'drafts')) {
      test('${item['name']}', () {
        final input = item['input'] as String?;
        if (item['valid'] == true) {
          expect(parseDraft(input).toJson(), item['result']);
        } else {
          expect(() => parseDraft(input), throwsA(anyOf(isA<ModelError>(), isA<FormatException>())));
        }
      });
    }
  });

  group('research jobs agree with readResearchJob', () {
    for (final item in _cases(builder, 'jobs')) {
      test('${item['name']}', () {
        if (item['valid'] == true) {
          expect(researchJobJson(readResearchJob(item['input'])), item['result']);
        } else {
          expect(() => readResearchJob(item['input']), throwsA(isA<ModelError>()));
        }
      });
    }
  });

  group('stops agree with validStops', () {
    for (final item in _cases(builder, 'stops')) {
      test('${item['name']}', () {
        final destination = item['destination'];
        expect(
          validStops(
            Place.fromJson(item['start']),
            (item['stops']! as List<Object?>).map(Place.fromJson).toList(),
            destination == null ? null : Place.fromJson(destination),
          ),
          item['valid'],
        );
      });
    }
  });

  group('parseDraft never accepts a damaged copy', () {
    test('a stored draft whose research belongs to a driving draft is rejected with the research message', () {
      final raw = jsonEncode({
        ...Draft.empty(TravelMode.driving).toJson(),
        'research': {'request': <String, Object?>{}, 'id': null, 'stops': <Object?>[], 'recoveryToken': 'x'},
      });
      expect(() => parseDraft(raw), throwsA(isA<ModelError>().having((e) => e.message, 'message', contains('исследование'))));
    });

    test('a route stored for a different stop list is rejected', () {
      final start = _place('Москва, Арбат, 1', 55.7515, 37.5925);
      final stop = _place('Москва, Арбат, 10', 55.752, 37.593);
      final plan = Plan(stops: [stop], geometry: [start.location, stop.location], distanceM: 100, walkingMinutes: 2, attribution: '©');
      final draft = Draft.empty().copyWith(start: Value(start), stops: [stop], route: Value(plan));
      expect(parseDraft(draft.encode()).route, isNotNull);
      final changed = draft.copyWith(stops: [_place('Москва, Арбат, 12', 55.7522, 37.5932)]);
      expect(() => parseDraft(changed.encode()), throwsA(isA<ModelError>()));
    });
  });

  group('editDraft', () {
    test('drops the route and marks an applied research as no longer applied', () {
      final start = _place('Москва, Арбат, 1', 55.7515, 37.5925);
      final stop = _place('Москва, Арбат, 10', 55.752, 37.593);
      final plan = Plan(stops: [stop], geometry: [start.location, stop.location], distanceM: 100, walkingMinutes: 2, attribution: '©');
      final draft = Draft.empty().copyWith(start: Value(start), stops: [stop], route: Value(plan), researchApplied: const Value(true));
      final edited = editDraft(draft, const DraftChange(minutes: 60));
      expect(edited.route, isNull);
      expect(edited.researchApplied, isFalse);
      expect(edited.minutes, 60);
      expect(editDraft(Draft.empty(), const DraftChange(minutes: 60)).researchApplied, isNull);
    });
  });

  group('stop limit', () {
    final start = _place('Москва, Арбат, 1', 55.7515, 37.5925);
    List<Place> stops(int count) => [for (var i = 0; i < count; i++) _place('Москва, Тверская, ${i + 1}', 55.757 + i * 0.0001, 37.613)];

    test('40 stops pass, 41 fail', () {
      expect(validStops(start, stops(40)), isTrue);
      expect(validStops(start, stops(41)), isFalse);
    });

    test('a story for the start building takes one of the 40 places', () {
      final jobs = [StoryRef(place: start, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', stage: GenerationStage.ready)];
      expect(manualStopLimit(start, jobs), 39);
      expect(validStops(start, stops(40), null, jobs), isFalse);
      expect(validStops(start, stops(39), null, jobs), isTrue);
    });
  });

  group('research', () {
    final start = _place('Москва, Арбат, 1', 55.7515, 37.5925);
    final stop = _place('Москва, Арбат, 10', 55.752, 37.593);
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const story = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    final request = ResearchRequest(start: start, mode: WalkMode.loop, minutes: 30);
    Object? job({String stage = 'ready', String phase = 'complete', String storyStage = 'ready'}) => jsonDecode(jsonEncode({
          'id': id,
          'stage': stage,
          'revision': 1,
          'request': request.toJson(),
          'phase': phase,
          'progress': {'checked': 3, 'total': 3, 'accepted': 1},
          'route': Plan(stops: [stop], geometry: [start.location, stop.location, start.location], distanceM: 400, walkingMinutes: 6, attribution: '©').toJson(),
          'stories': [StoryRef(place: stop, id: story, stage: GenerationStage.parse(storyStage)!).toJson()],
          'error': null,
          'canRetry': false,
        }));
    final draft = Draft.empty().copyWith(start: Value(start), research: Value(ResearchRef(request: request, id: id, stops: const [], recoveryToken: id)));

    test('the key ignores the address label and rounds to six decimals', () {
      final renamed = ResearchRequest(start: _place('Москва, Арбат, дом 1', 55.75150000001, 37.5925), mode: WalkMode.loop, minutes: 30);
      expect(researchKey(renamed), researchKey(request));
      expect(researchKey(request), '[55.7515,37.5925,"loop",30]');
    });

    test('lookup sends the recovery token and the rounded start', () {
      final lookup = researchLookup(request, 'token');
      expect(lookup.path, '/api/walk-research-jobs');
      expect(lookup.query, {'lat': '55.7515', 'lon': '37.5925', 'mode': 'loop', 'minutes': '30', 'recoveryToken': 'token'});
    });

    test('a job for another request is rejected', () {
      final other = ResearchRef(request: ResearchRequest(start: start, mode: WalkMode.loop, minutes: 60), id: null, stops: const [], recoveryToken: id);
      expect(() => readResearchJob(job(), other), throwsA(isA<ModelError>().having((e) => e.message, 'message', 'Сервис вернул другое исследование.')));
    });

    test('a ready job applies its route and stories', () {
      final applied = applyResearch(draft, readResearchJob(job()));
      expect(applied.researchApplied, isTrue);
      expect(applied.stops.single.address, stop.address);
      expect(applied.jobs.single.id, story);
    });

    test('an unfinished job or a story that is not ready is not applied', () {
      expect(() => applyResearch(draft, readResearchJob(job(stage: 'voicing', phase: 'narration'))), throwsA(isA<ModelError>()));
      expect(() => applyResearch(draft, readResearchJob(job(storyStage: 'voicing'))), throwsA(isA<ModelError>()));
    });

    test('a draft changed after the research was started does not take its route', () {
      final changed = editDraft(draft, const DraftChange(minutes: 60));
      expect(() => applyResearch(changed, readResearchJob(job())), throwsA(isA<ModelError>()));
    });

    test('research is offered only for a shortage of stops in automatic mode', () {
      expect(shouldOfferResearch(true, 'WALK_STOPS_NOT_FOUND'), isTrue);
      expect(shouldOfferResearch(false, 'WALK_STOPS_NOT_FOUND'), isFalse);
      expect(shouldOfferResearch(true, 'WALK_NOT_FOUND'), isFalse);
    });
  });

  group('storyAddressKey', () {
    final cases = {
      'Арбат, 1': 'москва арбат 1',
      'Москва, Арбат,  1': 'москва арбат 1',
      'Казань, улица Баумана, 5': 'казань улица баумана 5',
      'Московская улица, 5': 'москва московская улица 5',
      'Ёлочная ул., 3': 'москва елочная ул 3',
    };
    for (final MapEntry(:key, :value) in cases.entries) {
      test(key, () => expect(storyAddressKey(key), value));
    }
  });

  group('documents', () {
    final start = _place('Москва, Арбат, 1', 55.7515, 37.5925);
    final stop = Place(address: 'Москва, Арбат, 10', location: const GeoPoint(55.752, 37.593), contentId: 'osm:way:1', placeId: 'osm:way:2');
    const walkId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    test('a draft round-trips through a walk document, the start story becoming its first stop', () {
      final plan = Plan(stops: [stop], geometry: [start.location, stop.location, start.location], distanceM: 400, walkingMinutes: 6, attribution: '©', tunnels: const [(0, 1)]);
      final draft = Draft.empty().copyWith(
        title: 'Арбат',
        start: Value(start),
        stops: [stop],
        route: Value(plan),
        jobs: [StoryRef(place: start, id: jobId, stage: GenerationStage.voicing)],
      );
      final document = draftToWalkDocument(draft, walkId);
      final stops = (document['stops']! as List<Object?>).cast<Map<String, Object?>>();
      expect(stops.map((stop) => stop['storyRef']), [
        {'kind': 'job', 'id': jobId},
        {'kind': 'osm', 'id': 'osm:way:1'},
      ]);
      expect(stops.map((stop) => stop['id']), ['$walkId-stop-0', '$walkId-stop-1']);
      final back = walkDocumentToDraft(document, draft.jobs);
      expect(back.toJson(), draft.toJson());
    });

    test('texts and ids of stops kept by an edit survive the next save', () {
      final draft = Draft.empty().copyWith(start: Value(start), stops: [stop]);
      final first = draftToWalkDocument(draft, walkId);
      final edited = jsonDecode(jsonEncode(first)) as Map<String, Object?>;
      ((edited['stops']! as List<Object?>).first! as Map<String, Object?>)
        ..['id'] = 'kept-id'
        ..['transition'] = 'Поверните налево.';
      final second = draftToWalkDocument(draft, walkId, edited);
      final saved = (second['stops']! as List<Object?>).first! as Map<String, Object?>;
      expect(saved['id'], 'kept-id');
      expect(saved['transition'], 'Поверните налево.');
    });

    test('a draft outside the walk area cannot become a document', () {
      final draft = Draft.empty().copyWith(start: Value(_place('Москва, Арбат, 1', 59.9, 30.3)));
      expect(() => draftToWalkDocument(draft, walkId), throwsA(isA<InvalidWalkDocument>()));
    });
  });

  test('routeShortfall reports walks under three quarters of the chosen time', () {
    expect(routeShortfall(22, 30), 22);
    expect(routeShortfall(23, 30), isNull);
  });
}
