import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/app/router.dart' show walkActiveProvider;
import 'package:otgolosok/features/offline/offline_packs.dart';
import 'package:otgolosok/features/walks/walk_link.dart';
import 'package:otgolosok/features/walks/walk_player_slot.dart';
import 'package:otgolosok/features/walks/walk_screen.dart';

import '../auth/harness.dart';
import 'support.dart' show sampleView;
import 'widget_harness.dart';

const _token = '11111111-1111-4111-8111-111111111111';
const _view = 'GET /api/story-walks/arbat-test/view';
const _noReviews = Reply(200, {
  'summary': {'average': null, 'count': 0},
  'reviews': <Object?>[],
  'nextCursor': null,
  'mine': null,
});

void main() {
  late WalksHarness h;

  setUp(() {
    h = WalksHarness();
    h.server.on('GET /api/story-walks/arbat-test/reviews', _noReviews);
  });

  Future<void> open(WidgetTester tester, String location) => h.pump(tester, location: location, screens: {
        '/walk': (state) => WalkScreen(link: WalkLink.parse(state.uri.queryParameters)!),
      });

  testWidgets('a catalogue walk opens with its stops, direction and review form', (tester) async {
    h.server.on(_view, Reply(200, sampleView()));
    await open(tester, '/walk?catalog=arbat-test');

    expect(find.text('Остановки · 2'), findsOneWidget);
    expect(find.text('Оставить отзыв'), findsOneWidget);
    expect(find.textContaining('Офлайн-копия от'), findsNothing);
    // Russian is the default content language and goes without `?lang=`.
    expect(h.server.to(_view).single.query, isEmpty);
    expect(h.server.to('GET /api/story-walks/arbat-test/reviews'), hasLength(1));

    await tester.tap(find.text('Направление: с начала'));
    await tester.pumpAndSettle();
    expect(find.text('Направление: с конца'), findsOneWidget);
    expect(h.settings.reversed('arbat-test'), isTrue);
  });

  testWidgets('a missing walk explains why and leads back to the walks without a retry', (tester) async {
    h.server.on(_view, const Reply(404, {'error': {'code': 'NOT_FOUND', 'message': 'Прогулка не найдена.'}}));
    await open(tester, '/walk?catalog=arbat-test');

    expect(find.text('Прогулка не найдена.'), findsOneWidget);
    expect(find.text('Повторить'), findsNothing);
    await tester.tap(find.text('Вернуться к прогулкам'));
    await tester.pumpAndSettle();
    expect(h.opened, '/account/walks');
  });

  testWidgets('a server failure without a copy can be retried', (tester) async {
    h.server.on(_view, const Reply(503, {'error': {'message': 'Сервис недоступен.'}}));
    await open(tester, '/walk?catalog=arbat-test');
    expect(find.text('Повторить'), findsOneWidget);

    h.server.on(_view, Reply(200, sampleView()));
    await tester.tap(find.text('Повторить'));
    await tester.pumpAndSettle();
    expect(find.text('Остановки · 2'), findsOneWidget);
  });

  testWidgets('when the server fails the saved copy opens with its date', (tester) async {
    h.packs.keep(const OfflineWalkRef(scope: 'public:catalog', walkId: 'arbat-test'), sampleView());
    h.server.on(_view, const Reply(503, {'error': {'message': 'Сервис недоступен.'}}));
    await open(tester, '/walk?catalog=arbat-test');

    expect(find.textContaining('Офлайн-копия от'), findsOneWidget);
    expect(find.textContaining('Последняя редакция может быть новее.'), findsOneWidget);
    expect(find.text('Остановки · 2'), findsOneWidget);
  });

  testWidgets('a moved catalogue walk opens its shared link from the same stop', (tester) async {
    h.server.on(_view, const Reply(410, {'error': {'code': 'WALK_MOVED', 'message': 'Прогулка переехала.', 'share': _token}}));
    h.server.on('GET /api/story-walks/shared/$_token', Reply(200, sampleView()));
    h.server.on('GET /api/story-walks/shared/$_token/reviews', _noReviews);
    await open(tester, '/walk?catalog=arbat-test&fromStop=stop-2');

    expect(h.location, '/walk?share=$_token&fromStop=stop-2');
    expect(find.text('Остановки · 2'), findsOneWidget);
    expect(find.textContaining('Начало с остановки'), findsOneWidget);
  });

  testWidgets('a start stop that left the walk is reported instead of playing from elsewhere', (tester) async {
    h.server.on(_view, Reply(200, sampleView()));
    await open(tester, '/walk?catalog=arbat-test&fromStop=gone-stop');

    expect(find.text('Точка начала больше не входит в эту прогулку. Откройте подборку заново.'), findsOneWidget);
    expect(find.text('Остановки · 2'), findsNothing);
  });

  testWidgets('a stop chosen in the stops list restarts the walk from it', (tester) async {
    h.server.on(_view, Reply(200, sampleView()));
    await open(tester, '/walk?catalog=arbat-test');

    await tester.tap(find.text('Остановки · 2'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Начать с этой остановки').last);
    await tester.pumpAndSettle();
    expect(h.location, '/walk?catalog=arbat-test&fromStop=stop-2');
    expect(find.textContaining('Начало с остановки'), findsOneWidget);
  });

  testWidgets('the walk card opens a walk started from a stop without restarting it', (tester) async {
    h.server.on(_view, Reply(200, sampleView()));
    await open(tester, '/walk?catalog=arbat-test&fromStop=stop-2');
    ProviderScope.containerOf(tester.element(find.byType(WalkScreen))).read(walkActiveProvider.notifier).set(true);

    // The card's route has no fromStop, so a reopened app does not restart the walk at the stop.
    h.router.go('/walk?catalog=arbat-test');
    await tester.pumpAndSettle();
    expect(h.server.to(_view), hasLength(1));
    expect(find.textContaining('Начало с остановки'), findsOneWidget);
  });

  testWidgets('without a running walk the same walk without its stop opens from the start', (tester) async {
    h.server.on(_view, Reply(200, sampleView()));
    await open(tester, '/walk?catalog=arbat-test&fromStop=stop-2');

    h.router.go('/walk?catalog=arbat-test');
    await tester.pumpAndSettle();
    expect(h.server.to(_view), hasLength(2));
    expect(find.textContaining('Начало с остановки'), findsNothing);
  });

  testWidgets('saving and removing the offline copy switches the player between device and network audio', (tester) async {
    h.server.on(_view, Reply(200, sampleView()));
    await open(tester, '/walk?catalog=arbat-test');
    Map<String, Uri> playerAudio() => tester.widget<WalkPlayerSlot>(find.byType(WalkPlayerSlot)).localAudio;
    expect(playerAudio(), isEmpty);

    await tester.tap(find.byTooltip('Настройки прогулки'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Офлайн-копия'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Сохранить прогулку без сети'));
    await tester.pumpAndSettle();
    expect(h.packs.saved, hasLength(1));
    expect(playerAudio(), isNotEmpty);

    await tester.tap(find.text('Удалить офлайн-копию'));
    await tester.pumpAndSettle();
    expect(playerAudio(), isEmpty);
  });

  testWidgets('the menu offers rating, improvement requests and the offline copy', (tester) async {
    h.server.on(_view, Reply(200, sampleView()));
    await open(tester, '/walk?catalog=arbat-test');

    await tester.tap(find.byTooltip('Настройки прогулки'));
    await tester.pumpAndSettle();
    expect(find.text('Оценить прогулку'), findsOneWidget);
    expect(find.text('Что улучшить в прогулке?'), findsOneWidget);
    expect(find.text('Офлайн-копия'), findsOneWidget);
    expect(find.text('Изменить маршрут'), findsNothing);
  });
}
