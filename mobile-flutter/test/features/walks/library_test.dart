import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/api/paging.dart';
import 'package:otgolosok/features/walks/library_screen.dart';
import 'package:otgolosok/features/walks/local_walks.dart';
import 'package:otgolosok/features/walks/top_walks_view.dart';
import 'package:otgolosok/features/walks/walk_cards.dart';
import 'package:otgolosok/walk_engine/walk_view.dart';

import '../auth/harness.dart';
import 'support.dart' show sampleView;
import 'widget_harness.dart';

const _localId = '22222222-2222-4222-8222-222222222222';
const _accountId = '33333333-3333-4333-8333-333333333333';
const _token = '44444444-4444-4444-8444-444444444444';

Map<String, Object?> _topWalk(int rank, String id, String title) => {
      'id': id,
      'kind': 'catalog',
      'title': title,
      'rank': rank,
      'rating': {'average': null, 'count': 0},
      'distanceM': 2100,
      'walkingMinutes': 30,
      'stopCount': 4,
      'preview': null,
      'mapPreview': null,
      'startMetro': null,
      'endMetro': null,
    };

Map<String, Object?> _topPage(List<Map<String, Object?>> walks, {required int total, int? next}) => {
      'walks': walks,
      'total': total,
      'nextOffset': next,
      'filters': {'starts': <Object?>[], 'ends': <Object?>[], 'stations': <Object?>[]},
    };

Map<String, Object?> _accountWalk(String id, String title, {String visibility = 'private', String? token, bool draft = false}) => {
      'id': id,
      'title': title,
      'revision': 3,
      'updatedAt': '2026-10-01T10:00:00.000Z',
      'visibility': visibility,
      'shareToken': token,
      'listingStatus': null,
      'draft': draft,
      'travelMode': 'walking',
    };

WalkCard _card(String id, String updatedAt) =>
    WalkCard(kind: WalkCardKind.account, id: id, title: id, revision: 0, updatedAt: updatedAt, visibility: WalkVisibility.private);

void main() {
  group('the opening tab', () {
    final table = <String, (String?, bool, int, bool, LibraryTab?)>{
      'the address wins over own walks': ('top', false, 3, false, LibraryTab.top),
      'the address opens «mine» for a newcomer': ('mine', false, 0, false, LibraryTab.mine),
      'nothing is chosen while loading': (null, true, 0, false, null),
      'own walks open «mine»': (null, false, 1, false, LibraryTab.mine),
      'without own walks the top opens': (null, false, 0, false, LibraryTab.top),
      'a failed load keeps «mine» with its retry': (null, false, 0, true, LibraryTab.mine),
      'an unknown value is ignored': ('other', false, 0, false, LibraryTab.top),
    };
    for (final MapEntry(:key, :value) in table.entries) {
      test(key, () => expect(selectedLibraryTab(value.$1, loading: value.$2, ownCount: value.$3, failed: value.$4), value.$5));
    }
  });

  test('further pages do not repeat walks and cards go newest first', () {
    final merged = mergePage([_card('a', '2026-10-01'), _card('b', '2026-10-02')], [_card('b', '2026-10-02'), _card('c', '2026-10-03')], (card) => card.id);
    expect(merged.map((card) => card.id), ['a', 'b', 'c']);
    expect(sortCards(merged).map((card) => card.id), ['c', 'b', 'a']);
  });

  group('library', () {
    late WalksHarness h;

    setUp(() => h = WalksHarness());

    Future<void> open(WidgetTester tester, {String? tab}) => h.pump(tester, location: '/history', screens: {
          '/history': (state) => LibraryScreen(tab: tab),
        });

    // The session answer arrives through Dio timers, which the fake clock of a widget test holds.
    Future<void> guest(WidgetTester tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      h.server.on('GET /api/auth/session', const Reply(200, {'user': null, 'csrfToken': null}));
      await tester.runAsync(h.auth.session.load);
      expect(h.auth.session.known, isTrue);
    }

    void keepLocalWalk() {
      final json = Map<String, Object?>.from(sampleView()['document']! as Map<String, Object?>)..['id'] = _localId;
      h.local.walks[_localId] = LocalWalk(document: WalkDocument.fromJson(json), revision: 0);
    }

    testWidgets('a guest sees device walks and the invitation to sign in', (tester) async {
      keepLocalWalk();
      await guest(tester);
      await open(tester);

      expect(find.text('Арбат'), findsOneWidget);
      expect(find.text('Ваши прогулки — с вами'), findsOneWidget);
      expect(h.server.to('GET /api/me/walks'), isEmpty);
      await tester.tap(find.text('Арбат'));
      await tester.pumpAndSettle();
      expect(h.opened, '/walk?local=$_localId');
    });

    testWidgets('a guest without walks lands on the top', (tester) async {
      h.server.on('GET /api/auth/session', const Reply(200, {'user': null, 'csrfToken': null}));
      h.server.on('GET /api/top-walks', Reply(200, _topPage([_topWalk(1, 'arbat', 'Старый Арбат')], total: 1)));
      await guest(tester);
      await open(tester);

      expect(find.text('Старый Арбат'), findsOneWidget);
    });

    testWidgets('account and device walks are listed together, drafts on their own filter', (tester) async {
      keepLocalWalk();
      h.server.on('GET /api/me/walks', Reply(200, {
        'walks': [
          _accountWalk(_accountId, 'Бульвары', visibility: 'shared', token: _token),
          _accountWalk('55555555-5555-4555-8555-555555555555', 'Черновик у реки', draft: true),
        ],
        'nextCursor': null,
      }));
      await h.auth.signIn(passwordUser);
      await open(tester);

      expect(find.text('Бульвары'), findsOneWidget);
      expect(find.text('Арбат'), findsOneWidget);
      expect(find.text('Ваши прогулки — с вами'), findsNothing);

      await tester.tap(find.text('Черновики'));
      await tester.pumpAndSettle();
      expect(find.text('Черновик у реки'), findsOneWidget);
      expect(find.text('Бульвары'), findsNothing);
    });

    testWidgets('a failed account list keeps «mine» open with a retry', (tester) async {
      h.server.on('GET /api/me/walks', const Reply(403, {'error': {'message': 'Нет доступа.'}}));
      await h.auth.signIn(passwordUser);
      await open(tester);

      expect(find.text('Нет доступа.'), findsOneWidget);
      h.server.on('GET /api/me/walks', Reply(200, {
        'walks': [_accountWalk(_accountId, 'Бульвары')],
        'nextCursor': null,
      }));
      await tester.tap(find.text('Повторить'));
      await tester.pumpAndSettle();
      expect(find.text('Бульвары'), findsOneWidget);
      expect(find.text('Нет доступа.'), findsNothing);
    });
  });

  group('top', () {
    late WalksHarness h;

    setUp(() => h = WalksHarness());

    Future<void> open(WidgetTester tester) => h.pump(tester, location: '/', screens: {
          '/': (state) => const Scaffold(body: TopWalksView()),
        });

    testWidgets('pages are added on request and a card opens its walk', (tester) async {
      h.server.on('GET /api/top-walks', Reply(200, _topPage([_topWalk(1, 'arbat', 'Старый Арбат'), _topWalk(2, 'bulvary', 'Бульвары')], total: 3, next: 2)));
      await open(tester);

      expect(find.text('Загружено: 2 из 3'), findsOneWidget);
      expect(h.server.to('GET /api/top-walks').single.query, isEmpty);

      h.server.on('GET /api/top-walks', Reply(200, _topPage([_topWalk(3, 'kitay-gorod', 'Китай-город')], total: 3)));
      await tester.tap(find.text('Загрузить ещё'));
      await tester.pumpAndSettle();
      expect(h.server.to('GET /api/top-walks').last.query, {'offset': '2'});
      expect(find.text('Загружено: 3 из 3'), findsOneWidget);
      expect(find.text('Загрузить ещё'), findsNothing);

      await tester.tap(find.bySemanticsLabel('Подробнее о маршруте «Китай-город»'));
      await tester.pumpAndSettle();
      expect(h.opened, '/walk?catalog=kitay-gorod');
    });

    testWidgets('a failed load can be retried', (tester) async {
      h.server.on('GET /api/top-walks', const Reply(404, {'error': {'message': 'Не найдено.'}}));
      await open(tester);
      expect(find.text('Не найдено.'), findsOneWidget);

      h.server.on('GET /api/top-walks', Reply(200, _topPage(const [], total: 0)));
      await tester.tap(find.text('Повторить'));
      await tester.pumpAndSettle();
      expect(find.text('В топе пока пусто. Откройте свою прогулку всем — после проверки она появится здесь.'), findsOneWidget);
    });
  });
}
