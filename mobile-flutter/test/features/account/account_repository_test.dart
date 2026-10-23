import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/core/i18n/translations.dart';
import 'package:otgolosok/features/account/account_repository.dart';
import 'package:otgolosok/features/account/my_walks_screen.dart';

import '../auth/harness.dart';
import 'fixtures.dart';

void main() {
  group('AccountWalk.fromJson', () {
    test('reads a server card', () {
      final walk = AccountWalk.fromJson(walkJson());
      expect(walk.visibility, WalkVisibility.shared);
      expect(walk.shareToken, walkShareToken);
      expect(walk.distanceM, 4200);
      expect(walk.driving, isFalse);
    });

    test('a card with a broken snapshot has no route fields and still loads', () {
      final json = walkJson()..removeWhere((key, _) => const {'draft', 'travelMode', 'totalMinutes', 'walkingMinutes', 'distanceM'}.contains(key));
      final walk = AccountWalk.fromJson(json);
      expect(walk.draft, isFalse);
      expect(walk.walkingMinutes, isNull);
    });

    final broken = <String, Map<String, Object?>>{
      'id is not a uuid': {'id': '../../etc'},
      'revision is not an integer': {'revision': '3'},
      'unknown visibility': {'visibility': 'friends'},
      'unknown listing status': {'visibility': 'public', 'listingStatus': 'featured'},
      'share token is not a uuid': {'shareToken': 'abc'},
      'negative distance': {'distanceM': -1},
      'unknown travel mode': {'travelMode': 'bike'},
    };
    for (final MapEntry(key: name, value: overrides) in broken.entries) {
      test('rejects: $name', () => expect(() => AccountWalk.fromJson(walkJson(overrides)), throwsFormatException));
    }

    test('access label in words for every state', () {
      final cases = {
        ('private', null): 'Только я',
        ('shared', null): 'По ссылке',
        ('public', 'pending'): 'Всем · на проверке',
        ('public', 'approved'): 'Всем · в топе',
        ('public', 'hidden'): 'Всем · скрыта редакцией из топа',
      };
      final translations = loadTranslations();
      for (final MapEntry(key: (visibility, status), :value) in cases.entries) {
        final label = AccountWalk.fromJson(walkJson({'visibility': visibility, 'listingStatus': status})).accessLabel;
        expect(label, value);
        expect(translations.has(label), isTrue, reason: label);
      }
    });
  });

  test('favourites open only walk links the app understands', () {
    Favorite favorite(String? href) => Favorite.fromJson({'type': 'walk', 'id': 'x', 'createdAt': '2026-10-01T00:00:00Z', 'title': 't', 'href': href});
    expect(favorite('/walk?id=$walkId').walkLocation, '/walk?id=$walkId');
    expect(favorite('/walk?catalog=arbat').walkLocation, '/walk?catalog=arbat');
    expect(favorite('/walk?share=$walkShareToken').walkLocation, '/walk?share=$walkShareToken');
    expect(favorite('/?job=abc').walkLocation, isNull);
    expect(favorite('/walk?id=$walkId&next=https://evil').walkLocation, isNull);
    expect(favorite('https://evil.example/walk?id=1').walkLocation, isNull);
    expect(favorite(null).walkLocation, isNull);
  });

  test('mergePage skips items already shown', () {
    expect(mergePage([1, 2], [2, 3, 3], (value) => '$value'), [1, 2, 3]);
  });

  test('kilometres use the decimal separator of the language', () {
    expect(formatKilometres(4250, AppLocale.ru), '4,3');
    expect(formatKilometres(4250, AppLocale.en), '4.3');
    expect(formatKilometres(800, AppLocale.zh), '0.8');
  });

  group('requests to /api/me', () {
    late Harness h;
    late AccountRepository account;

    setUp(() async {
      h = Harness();
      account = AccountRepository(api: h.api, session: h.session);
      await h.signIn(telegramUser);
    });

    test('pages pass the cursor and fail closed on a malformed page', () async {
      h.server.on('GET /api/me/walks', Reply(200, {'walks': [walkJson()], 'nextCursor': 'next-1'}));
      final page = await account.walks(cursor: 'c1');
      expect(h.server.sent.single.query, {'cursor': 'c1'});
      expect(page.nextCursor, 'next-1');

      h.server.on('GET /api/me/walks', const Reply(200, {'walks': 'nope'}));
      await expectLater(account.walks(), throwsA(anything));
    });

    test('rename keeps the Telegram re-auth state of the session', () async {
      h.server.on('PATCH /api/me', const Reply(200, {'user': {'id': 'user-2', 'name': 'Иван Иванов', 'email': null}}));
      await account.rename('Иван Иванов');
      expect(h.session.user?.name, 'Иван Иванов');
      expect(h.session.user?.telegram, isTrue);
      expect(h.session.user?.requiresReauthentication, isTrue);
    });

    test('visibility change sends the revision it was based on', () async {
      h.server.on('PUT /api/me/walks/$walkId/sharing', Reply(200, {'walk': walkJson({'visibility': 'public', 'listingStatus': 'pending', 'revision': 4})}));
      final updated = await account.setVisibility(AccountWalk.fromJson(walkJson()), WalkVisibility.public);
      expect(h.server.sent.single.body, {'revision': 3, 'visibility': 'public'});
      expect(updated.awaitsReview, isTrue);
    });
  });
}
