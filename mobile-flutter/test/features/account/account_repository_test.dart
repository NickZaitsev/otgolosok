import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/account/account_repository.dart';

import '../auth/harness.dart';
import '../walks/account_walk_fixtures.dart';

void main() {
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

  group('requests to /api/me', () {
    late Harness h;
    late AccountRepository account;

    setUp(() async {
      h = Harness();
      account = AccountRepository(api: h.api, session: h.session);
      await h.signIn(telegramUser);
    });

    test('rename keeps the Telegram re-auth state of the session', () async {
      h.server.on('PATCH /api/me', const Reply(200, {'user': {'id': 'user-2', 'name': 'Иван Иванов', 'email': null}}));
      await account.rename('Иван Иванов');
      expect(h.session.user?.name, 'Иван Иванов');
      expect(h.session.user?.telegram, isTrue);
      expect(h.session.user?.requiresReauthentication, isTrue);
    });
  });
}
