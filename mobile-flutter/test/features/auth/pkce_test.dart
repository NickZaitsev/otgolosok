import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/auth/pkce.dart';
import 'package:otgolosok/features/auth/telegram_callback.dart';

/// Replays fixed bytes, so the verifier is the RFC 7636 Appendix B example.
class _Bytes implements Random {
  _Bytes(this.bytes);
  final List<int> bytes;
  var _index = 0;

  @override
  int nextInt(int max) => bytes[_index++];

  @override
  bool nextBool() => throw UnimplementedError();

  @override
  double nextDouble() => throw UnimplementedError();
}

void main() {
  group('Pkce', () {
    const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const rfcChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    const rfcBytes = [
      116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, //
      22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
    ];

    test('challenge is base64url(SHA-256(verifier)) without padding (RFC 7636 vector)', () {
      expect(Pkce.challengeOf(rfcVerifier), rfcChallenge);
    });

    test('generate encodes 32 random bytes as the verifier', () {
      final pkce = Pkce.generate(_Bytes(rfcBytes));
      expect(pkce.verifier, rfcVerifier);
      expect(pkce.challenge, rfcChallenge);
    });

    test('secure generation gives 43-character values that differ per sign-in', () {
      final first = Pkce.generate(), second = Pkce.generate();
      expect(Pkce.isValue(first.verifier), isTrue);
      expect(Pkce.isValue(first.challenge), isTrue);
      expect(first.verifier, isNot(second.verifier));
      expect(first.toString(), isNot(contains(first.verifier)));
    });
  });

  group('TelegramCallback.parse', () {
    final code = 'A' * 42 + '_';
    final cases = <String, TelegramCallback>{
      'otgolosok-auth://telegram?code=$code': TelegramCode(code),
      'otgolosok-auth://telegram?error=TERMS_REQUIRED': const TelegramError(TelegramFailure.termsRequired),
      'otgolosok-auth://telegram?error=CANCELLED': const TelegramError(TelegramFailure.cancelled),
      'otgolosok-auth://telegram?error=FAILED': const TelegramError(TelegramFailure.failed),
      'otgolosok-auth://telegram?error=SOMETHING_NEW': const TelegramError(TelegramFailure.failed),
      // Garbage and lookalikes fail closed.
      'otgolosok-auth://telegram?code=short': const TelegramError(TelegramFailure.failed),
      'otgolosok-auth://telegram?code=${'A' * 42}!': const TelegramError(TelegramFailure.failed),
      'otgolosok-auth://telegram?code=$code&code=$code': const TelegramError(TelegramFailure.failed),
      'otgolosok-auth://telegram?code=$code&error=FAILED': const TelegramError(TelegramFailure.failed),
      'otgolosok-auth://telegram': const TelegramError(TelegramFailure.failed),
      'otgolosok-auth://other?code=$code': const TelegramError(TelegramFailure.failed),
      'https://otgolosok.online/app-auth/telegram?code=$code': const TelegramError(TelegramFailure.failed),
      'evil-auth://telegram?code=$code': const TelegramError(TelegramFailure.failed),
      '::not a url::': const TelegramError(TelegramFailure.failed),
      '': const TelegramError(TelegramFailure.failed),
    };
    for (final MapEntry(key: raw, value: expected) in cases.entries) {
      test(raw.isEmpty ? '(empty)' : raw, () {
        final parsed = TelegramCallback.parse(raw);
        if (expected is TelegramCode) {
          expect(parsed, isA<TelegramCode>().having((value) => value.code, 'code', expected.code));
        } else {
          expect(parsed, expected);
        }
      });
    }
  });
}
