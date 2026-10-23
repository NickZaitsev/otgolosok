import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/walks/walk_cards.dart';

import '../auth/harness.dart';
import 'account_walk_fixtures.dart';

void main() {
  group('WalkCard.account', () {
    test('reads a list card', () {
      final walk = WalkCard.account(walkJson());
      expect(walk.kind, WalkCardKind.account);
      expect(walk.visibility, WalkVisibility.shared);
      expect(walk.shareToken, walkShareToken);
      expect(walk.revision, 3);
      expect(walk.distanceM, 4200);
      expect(walk.driving, isFalse);
      expect(walk.location, '/walk?id=$walkId');
      expect(walk.editLocation, '/builder?id=$walkId&edit=1');
    });

    test('a card with a broken snapshot, or a single-walk answer, has no route fields and still loads', () {
      final json = walkJson()..removeWhere((key, _) => const {'draft', 'travelMode', 'totalMinutes', 'walkingMinutes', 'distanceM'}.contains(key));
      final walk = WalkCard.account({...json, 'snapshot': <String, Object?>{}});
      expect(walk.draft, isFalse);
      expect(walk.walkingMinutes, isNull);
    });

    test('a private walk drops a stale share token', () {
      expect(WalkCard.account(walkJson({'visibility': 'private'})).shareToken, isNull);
    });

    final broken = <String, Map<String, Object?>>{
      'id is not a uuid': {'id': '../../etc'},
      'revision is not an integer': {'revision': '3'},
      'negative revision': {'revision': -1},
      'unknown visibility': {'visibility': 'friends'},
      'unknown listing status': {'visibility': 'public', 'listingStatus': 'featured'},
      'share token is not a uuid': {'shareToken': 'abc'},
      'a link without a share token': {'visibility': 'shared', 'shareToken': null},
      'negative distance': {'distanceM': -1},
      'unknown travel mode': {'travelMode': 'bike'},
    };
    for (final MapEntry(key: name, value: overrides) in broken.entries) {
      test('rejects: $name', () => expect(() => WalkCard.account(walkJson(overrides)), throwsFormatException));
    }

    test('access label in words for every state, each in the dictionary', () {
      final cases = {
        ('private', null): 'Только я',
        ('shared', null): 'По ссылке',
        ('public', 'pending'): 'Всем · на проверке',
        ('public', null): 'Всем · на проверке',
        ('public', 'approved'): 'Всем · в топе',
        ('public', 'hidden'): 'Всем · скрыта редакцией из топа',
      };
      final translations = loadTranslations();
      for (final MapEntry(key: (visibility, status), :value) in cases.entries) {
        final card = WalkCard.account(walkJson({'visibility': visibility, 'listingStatus': status}));
        expect(card.accessLabel, value);
        expect(translations.has(card.accessLabel), isTrue, reason: value);
        expect(card.awaitsReview, visibility == 'public' && status == 'pending');
      }
    });
  });

  group('AccountWalksApi', () {
    late Harness h;
    late AccountWalksApi walks;

    setUp(() async {
      h = Harness();
      walks = AccountWalksApi(h.api);
      await h.signIn(telegramUser);
    });

    test('pages pass the cursor and fail closed on a malformed page', () async {
      h.server.on('GET /api/me/walks', Reply(200, {'walks': [walkJson()], 'nextCursor': 'next-1'}));
      final page = await walks.list(cursor: 'c1');
      expect(h.server.sent.single.query, {'cursor': 'c1'});
      expect(page.nextCursor, 'next-1');
      expect(page.walks.single.id, walkId);

      h.server.on('GET /api/me/walks', const Reply(200, {'walks': 'nope'}));
      await expectLater(walks.list(), throwsA(anything));
    });

    test('an access change sends the revision it was based on and applies the answer', () async {
      h.server.on('PUT /api/me/walks/$walkId/sharing', Reply(200, {'walk': walkJson({'visibility': 'public', 'listingStatus': 'pending', 'revision': 4})}));
      final card = WalkCard.account(walkJson());
      final access = await walks.setVisibility(card.id, card.revision, WalkVisibility.public);
      expect(h.server.sent.single.body, {'revision': 3, 'visibility': 'public'});
      final updated = card.withAccess(access);
      expect(updated.revision, 4);
      expect(updated.awaitsReview, isTrue);
      expect(updated.title, card.title);
    });
  });
}
