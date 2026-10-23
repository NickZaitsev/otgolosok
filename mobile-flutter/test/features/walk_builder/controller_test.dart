import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/auth/session.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/walk_builder/builder_controller.dart';
import 'package:otgolosok/features/walk_builder/builder_storage.dart';
import 'package:otgolosok/features/walk_builder/messages.dart';
import 'package:otgolosok/features/walk_builder/model.dart';
import 'package:otgolosok/features/walk_builder/walk_document.dart';
import 'package:otgolosok/walk_engine/distance.dart';

import '../auth/harness.dart';
import 'support.dart';

final _translations = loadTranslations();

/// The Russian text the screen would show for [text].
String? shown(UiText? text) => switch (text) {
      null => null,
      Phrase(:final source, :final values) => _translations.translate(AppLocale.ru, source, values),
      ErrorText(:final error, :final fallback, :final template) => () {
          final message = errorSource(error, fallback, locale: AppLocale.ru, known: _translations.has);
          return template == null ? message : _translations.translate(AppLocale.ru, template, {'error': message});
        }(),
      LocateFailureText(:final source) => source,
    };

Future<void> settle() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

Map<String, Object?> _job(String name) {
  final jobs = (fixture('walk_builder.json')['jobs']! as List<Object?>).cast<Map<String, Object?>>();
  return jobs.firstWhere((item) => item['name'] == name)['input']! as Map<String, Object?>;
}

Place get _stop => fixturePlan().stops.single;

Future<Setup> _opened({AuthUser? user, Draft? draft, Map<String, String> extra = const {}}) async {
  final setup = Setup(user: user, storage: MemoryBuilderStorage({BuilderKeys.draft: (draft ?? startDraft()).encode(), ...extra}));
  await setup.controller.restore();
  return setup;
}

void main() {
  group('BuilderArgs.parse', () {
    final cases = <String, (Map<String, String>, String?)>{
      'nothing': ({}, null),
      'local walk': ({'local': 'cccccccc-dddd-4eee-8fff-000000000001'}, null),
      'two walks': ({'local': 'cccccccc-dddd-4eee-8fff-000000000001', 'id': walkId}, 'Ссылка содержит конфликтующие параметры.'),
      'new and resume': ({'new': '1', 'resume': '1'}, 'Ссылка содержит конфликтующие параметры.'),
      'catalog walk': ({'catalog': 'x'}, 'Редактировать можно только свою прогулку.'),
      'bad local ID': ({'local': 'nope'}, 'Локальная прогулка не найдена. Исходные данные сохранены.'),
      'bad account ID': ({'id': 'nope'}, 'Прогулка не найдена.'),
      'start outside Moscow': ({'address': 'Санкт-Петербург, Невский, 1', 'lat': '59.93', 'lon': '30.33'}, 'В ссылке нет корректной точки начала. Выберите адрес в Москве.'),
      'start in Moscow': ({'address': 'Москва, Арбат, 1', 'lat': '55.7515', 'lon': '37.5925'}, null),
    };
    for (final MapEntry(key: name, value: (query, error)) in cases.entries) {
      test(name, () {
        final parsed = BuilderArgs.parse(query);
        expect(parsed.error, error);
        expect(parsed.args == null, error != null);
      });
    }
  });

  group('restore', () {
    test('a start point from the map becomes a new local walk', () async {
      final setup = Setup(args: BuilderArgs(incoming: startPlace));
      await setup.controller.restore();
      final c = setup.controller;
      expect(c.storageError, isNull);
      expect(c.draft.start, startPlace);
      expect(c.draft.title, 'Прогулка от Москва, Арбат, 1');
      expect(parseDraft(setup.storage.values[BuilderKeys.draft]).start, startPlace);
      final localId = setup.storage.values[BuilderKeys.activeLocal]!;
      expect((await setup.walks.getJson(localId))?.revision, 0);
      expect(c.openLocation, '/walk?local=$localId');
    });

    test('an unreadable draft is offered for download and never overwritten', () async {
      final setup = Setup(storage: MemoryBuilderStorage({BuilderKeys.draft: '{"version":1,'}));
      await setup.controller.restore();
      final c = setup.controller;
      expect(c.loaded, isTrue);
      expect(c.storageError, isNotNull);
      expect(c.writable, isFalse);
      expect(c.downloadText(), '{"version":1,');
      expect(await c.edit(DraftChange(start: const Value(startPlace))), isFalse);
      expect(setup.storage.values[BuilderKeys.draft], '{"version":1,');
    });

    test('an account walk asks a guest to sign in without loading it', () async {
      final setup = Setup(args: const BuilderArgs(accountId: walkId));
      await setup.controller.restore();
      expect(setup.controller.loginRequired, isTrue);
      expect(setup.server.sent, isEmpty);
    });

    test('an account walk opens from its snapshot', () async {
      final setup = Setup(user: user, args: const BuilderArgs(accountId: walkId));
      final snapshot = draftToWalkDocument(startDraft(route: fixturePlan(), stops: [_stop]), walkId);
      setup.server.on('GET /api/me/walks/$walkId', Reply(200, {'walk': accountWalkJson(revision: 3, snapshot: snapshot)}));
      await setup.controller.restore();
      final c = setup.controller;
      expect(c.storageError, isNull);
      expect(c.draft.route, isNotNull);
      expect(c.draft.stops.single.address, _stop.address);
      expect(c.openLocation, '/walk?id=$walkId');
      expect(setup.storage.values[BuilderKeys.activeRevision], '3');
    });

    test('an edit pending for an account walk changed on the server stops instead of overwriting', () async {
      final setup = Setup(
        user: user,
        args: const BuilderArgs(accountId: walkId),
        storage: MemoryBuilderStorage({
          BuilderKeys.draft: startDraft().encode(),
          BuilderKeys.activeAccount: walkId,
          BuilderKeys.activeRevision: '1',
        }),
      );
      setup.server.on('GET /api/me/walks/$walkId', Reply(200, {'walk': accountWalkJson(revision: 2, snapshot: draftToWalkDocument(startDraft(), walkId))}));
      await setup.controller.restore();
      expect(shown(setup.controller.storageError), 'Прогулка в аккаунте изменилась. Скачайте черновик перед обновлением страницы.');
      expect(setup.controller.writable, isFalse);
    });

    test('a failed session check keeps the local draft editable', () async {
      final setup = Setup(sessionFails: true, storage: MemoryBuilderStorage({BuilderKeys.draft: startDraft().encode()}));
      await setup.controller.restore();
      expect(shown(setup.controller.error), 'Не удалось проверить вход. Локальный черновик доступен.');
      expect(setup.controller.writable, isTrue);
      expect(setup.controller.draft.start, startPlace);
    });
  });

  group('address search', () {
    test('a found house becomes the candidate; lookups are spaced by 1.1 s', () async {
      final setup = await _opened();
      setup.server.on('GET /api/story-place', Reply(200, placeJson(otherPlace)));
      expect(await setup.controller.resolve(query: 'Тверская 7'), otherPlace);
      expect(setup.controller.candidate, otherPlace);
      await setup.controller.resolve(point: const GeoPoint(55.7579, 37.6136));
      expect(setup.clock.sleeps, [const Duration(milliseconds: 1100)]);
      expect(setup.server.to('GET /api/story-place').map((request) => request.query), [
        {'q': 'Тверская 7'},
        {'lat': '55.7579', 'lon': '37.6136'},
      ]);
    });

    test('an answer that is not a house is an error', () async {
      final setup = await _opened();
      setup.server.on('GET /api/story-place', const Reply(200, {'address': 'Москва'}));
      expect(await setup.controller.resolve(query: 'Москва'), isNull);
      expect(shown(setup.controller.error), 'Не найден точный адрес дома в Москве. Уточните улицу и номер.');
    });

    test('a busy search asks to wait a second', () async {
      final setup = await _opened();
      setup.server.on('GET /api/story-place', const Reply(429, {'error': {'code': 'PLACE_BUSY', 'message': 'Поиск занят. Повторите через пару секунд.'}}));
      expect(await setup.controller.resolve(query: 'Арбат 1'), isNull);
      expect(shown(setup.controller.error), 'Подождите секунду и повторите поиск.');
      expect(setup.controller.busyNow, isFalse);
    });
  });

  group('plan', () {
    test('an automatic plan picks the stops and opens the local walk', () async {
      final setup = await _opened();
      setup.server.on('POST /api/walk-plan', Reply(200, validPlan()));
      final location = await setup.controller.build();
      final localId = setup.storage.values[BuilderKeys.activeLocal];
      expect(location, '/walk?local=$localId');
      final body = setup.server.to('POST /api/walk-plan').single.body! as Map<String, Object?>;
      expect(body, isNot(contains('stops')));
      expect(body, containsPair('minutes', 30));
      expect(setup.controller.draft.stops.single.address, _stop.address);
      expect(parseDraft(setup.storage.values[BuilderKeys.draft]).route, isNotNull);
    });

    test('a route longer than the chosen time is rejected', () async {
      final setup = await _opened();
      setup.server.on('POST /api/walk-plan', Reply(200, {...validPlan(), 'walkingMinutes': 45}));
      expect(await setup.controller.plan(), isFalse);
      expect(setup.controller.draft.route, isNull);
      expect(shown(setup.controller.error), 'Сервис вернул некорректный маршрут. Попробуйте построить заново.');
    });

    test('too few stories nearby offers research', () async {
      final setup = await _opened();
      setup.server.on('POST /api/walk-plan', const Reply(404, {'error': {'code': 'WALK_STOPS_NOT_FOUND', 'message': 'Рядом нет историй.'}}));
      expect(await setup.controller.plan(), isFalse);
      expect(setup.controller.researchOffered, isTrue);
      expect(setup.controller.research.visible, isTrue);
      expect(setup.controller.research.canStart, isTrue);
      expect(shown(setup.controller.error), 'Рядом пока мало готовых историй.');
    });

    test('a rate limit shows the server text after the retries', () async {
      final setup = await _opened();
      setup.server.on('POST /api/walk-plan', const Reply(429, {'error': {'code': 'WALK_RATE_LIMITED', 'message': 'Слишком частые запросы маршрута. Повторите через пару секунд.'}}));
      expect(await setup.controller.plan(), isFalse);
      expect(shown(setup.controller.error), 'Слишком частые запросы маршрута. Повторите через пару секунд.');
      expect(setup.controller.researchOffered, isFalse);
    });
  });

  group('story jobs', () {
    // The fixture stop already has a published story; without it the stop needs a new one.
    final plan = Plan.fromJson({
      ...validPlan(),
      'stops': [_stop.bare.toJson()],
    });
    final stop = plan.stops.single;
    Future<Setup> built({AuthUser? user}) => _opened(user: user, draft: startDraft(route: plan, stops: [stop]));

    test('the next stop gets one story, sent with an idempotency key and followed to the end', () async {
      final setup = await built();
      setup.server
        ..on('POST /api/story-jobs', const Reply(201, {'id': jobId, 'stage': 'queued'}))
        ..on('GET /api/story-jobs/$jobId', Reply(200, {'id': jobId, 'stage': 'ready', 'address': _stop.address}));
      final c = setup.controller..setReviewed(true);
      await c.prepareNext();
      final body = setup.server.to('POST /api/story-jobs').single.body! as Map<String, Object?>;
      expect(body['address'], _stop.address);
      expect(body['idempotencyKey'], isA<String>());
      expect(c.draft.submitting, isNull);
      expect(c.draft.jobs.single.id, jobId);
      await settle();
      expect(c.draft.jobs.single.stage, GenerationStage.ready);
      expect(c.pollId, isNull);
      expect(c.nextPlace, isNull);
    });

    test('nothing is sent before the consent is given', () async {
      final setup = await built();
      await setup.controller.prepareNext();
      expect(setup.server.sent, isEmpty);
    });

    test('a refusal clears the unknown send', () async {
      final setup = await built();
      setup.server.on('POST /api/story-jobs', const Reply(401, {'error': {'code': 'UNAUTHORIZED', 'message': 'Войдите, чтобы подготовить историю.'}}));
      final c = setup.controller..setReviewed(true);
      await c.prepareNext();
      expect(c.draft.submitting, isNull);
      expect(parseDraft(setup.storage.values[BuilderKeys.draft]).submitting, isNull);
      expect(shown(c.error), 'Войдите в аккаунт.');
    });

    test('a lost answer keeps the send as unknown and is never repeated by itself', () async {
      final setup = await built();
      setup.server.on('POST /api/story-jobs', const Reply(500));
      final c = setup.controller..setReviewed(true);
      await c.prepareNext();
      expect(c.draft.submitting?.address, _stop.address);
      expect(parseDraft(setup.storage.values[BuilderKeys.draft]).submitting?.address, _stop.address);
      expect(shown(c.error), endsWith('Результат отправки неизвестен. Не повторяем её автоматически.'));
      final sends = setup.server.to('POST /api/story-jobs').length;
      c.setReviewed(true);
      await c.prepareNext();
      expect(setup.server.to('POST /api/story-jobs').length, sends);
    });

    test('an unknown send is recovered by the story ID of the same address', () async {
      final setup = await _opened(draft: startDraft(route: plan, stops: [stop], submitting: stop));
      setup.server.on('GET /api/story-jobs/$jobId', Reply(200, {'id': jobId, 'stage': 'writing', 'address': _stop.address}));
      final c = setup.controller..setRecoveryId(' $jobId ');
      await c.recoverJob();
      expect(c.error, isNull);
      expect(c.draft.submitting, isNull);
      expect(c.draft.jobs.single.stage, GenerationStage.writing);
    });

    test('a story of another address is not attached', () async {
      final setup = await _opened(draft: startDraft(route: plan, stops: [stop], submitting: stop));
      setup.server.on('GET /api/story-jobs/$jobId', const Reply(200, {'id': jobId, 'stage': 'ready', 'address': 'Москва, Тверская улица, 7'}));
      final c = setup.controller..setRecoveryId(jobId);
      await c.recoverJob();
      expect(shown(c.error), 'История относится к другому адресу.');
      expect(c.draft.submitting, isNotNull);
      expect(c.draft.jobs, isEmpty);
    });
  });

  group('saving to the account', () {
    Draft builtDraft() => startDraft(route: fixturePlan(), stops: [_stop]);

    test('a guest is sent to sign in', () async {
      final setup = await _opened(draft: builtDraft());
      expect(await setup.controller.saveToAccount(), SaveOutcome.login);
      expect(setup.server.sent, isEmpty);
    });

    test('a repeated save after a lost answer reuses the idempotency key, then edits by revision', () async {
      final setup = await _opened(user: user, draft: builtDraft());
      final c = setup.controller;
      setup.server.on('POST /api/me/walks', const Reply(500));
      expect(await c.saveToAccount(), SaveOutcome.failed);
      expect(shown(c.error), isNotNull);
      setup.server.on('POST /api/me/walks', Reply(201, {'walk': accountWalkJson(snapshot: draftToWalkDocument(builtDraft(), walkId))}));
      expect(await c.saveToAccount(), SaveOutcome.saved);
      final keys = {for (final request in setup.server.to('POST /api/me/walks')) (request.body! as Map<String, Object?>)['idempotencyKey']};
      expect(keys, hasLength(1));
      expect(c.openLocation, '/walk?id=$walkId');
      expect(shown(c.message), 'Прогулка сохранена в личном кабинете.');

      setup.server.on('PATCH /api/me/walks/$walkId', Reply(200, {'walk': accountWalkJson(revision: 1, visibility: 'public', listingStatus: 'pending')}));
      expect(await c.saveToAccount(), SaveOutcome.review);
      final patch = setup.server.to('PATCH /api/me/walks/$walkId').single.body! as Map<String, Object?>;
      expect(patch['revision'], 0);
      expect(setup.storage.values[BuilderKeys.activeRevision], '1');
      expect(shown(c.message), 'Прогулка сохранена. В топе она появится после проверки редакцией.');
    });
  });

  group('research', () {
    const token = 'cccccccc-dddd-4eee-8fff-999999999999';
    const researchId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    test('an offered research is sent with consent, then its route is applied and opened', () async {
      final setup = await _opened();
      final c = setup.controller;
      setup.server
        ..on('POST /api/walk-plan', const Reply(404, {'error': {'code': 'WALK_STOPS_NOT_FOUND', 'message': 'Рядом нет историй.'}}))
        ..on('POST /api/walk-research-jobs', Reply(201, _job('complete with a route')))
        ..on('GET /api/walk-research-jobs/$researchId', Reply(200, _job('complete with a route')));
      await c.plan();
      await c.research.submit(disabled: false);
      await settle();
      final body = setup.server.to('POST /api/walk-research-jobs').single.body! as Map<String, Object?>;
      expect(body['consent'], isTrue);
      expect(body['recoveryToken'], isA<String>());
      expect(c.draft.research?.id, researchId);
      expect(c.research.visibleJob?.stage, GenerationStage.ready);
      final location = await c.research.apply();
      expect(location, startsWith('/walk?local='));
      expect(c.draft.researchApplied, isTrue);
      expect(c.draft.route?.stops.single.address, _stop.address);
    });

    test('a saved research the server no longer knows is reported as missing', () async {
      final request = ResearchRequest(start: startPlace, destination: null, mode: WalkMode.loop, minutes: 30);
      final draft = startDraft().copyWith(research: Value(ResearchRef(request: request, id: researchId, stops: const [], recoveryToken: token)));
      Future<Setup> setup() async {
        final s = Setup(storage: MemoryBuilderStorage({BuilderKeys.draft: draft.encode()}));
        s.server.on('GET /api/walk-research-jobs/$researchId', const Reply(404, {'error': {'code': 'NOT_FOUND', 'message': 'Not found'}}));
        await s.controller.restore();
        await settle();
        return s;
      }

      final s = await setup();
      expect(s.controller.research.missing, isTrue);
      expect(shown(s.controller.research.error), 'Сохранённая задача не найдена. Её ID остаётся в черновике.');
      expect(s.controller.draft.research?.id, researchId);
    });
  });

  test('the downloadable copy of a readable draft is the current draft', () async {
    final setup = await _opened();
    expect(jsonDecode(setup.controller.downloadText()), setup.controller.draft.toJson());
  });
}
