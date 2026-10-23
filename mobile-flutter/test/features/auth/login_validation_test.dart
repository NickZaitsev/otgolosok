import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/features/auth/login_validation.dart';

import 'harness.dart';

void main() {
  test('email follows the rule of <input type=email>', () {
    final cases = <String, String?>{
      '': 'Введите email.',
      '   ': 'Введите email.',
      'anna@example.com': null,
      '  anna@example.com  ': null,
      'a@b': null,
      "o'neil+tag@sub.example.org": null,
      'anna': 'Проверьте адрес email.',
      'anna@': 'Проверьте адрес email.',
      '@example.com': 'Проверьте адрес email.',
      'an na@example.com': 'Проверьте адрес email.',
      'anna@-example.com': 'Проверьте адрес email.',
      'anna@example..com': 'Проверьте адрес email.',
    };
    for (final MapEntry(:key, :value) in cases.entries) {
      expect(validateEmail(key), value, reason: key);
    }
  });

  test('password must be 10 to 128 characters, as Better Auth on the server', () {
    final cases = <String, String?>{
      '': 'Введите пароль.',
      '123456789': 'Пароль должен содержать от 10 до 128 символов.',
      '1234567890': null,
      'x' * 128: null,
      'x' * 129: 'Пароль должен содержать от 10 до 128 символов.',
    };
    for (final MapEntry(:key, :value) in cases.entries) {
      expect(validatePassword(key), value, reason: '${key.length} characters');
    }
  });

  test('name is required and at most 80 characters after trimming', () {
    expect(validateName(''), 'Введите имя.');
    expect(validateName('   '), 'Введите имя.');
    expect(validateName('Анна'), isNull);
    expect(validateName('${'я' * 80}  '), isNull);
    expect(validateName('я' * 81), 'Имя должно быть не длиннее 80 символов.');
  });

  test('every validation message has translations', () {
    final translations = loadTranslations();
    final messages = [
      validateEmail(''), validateEmail('x'), validatePassword(''), validatePassword('x'), validateName(''), validateName('я' * 81),
    ];
    for (final message in messages) {
      expect(translations.has(message!), isTrue, reason: message);
    }
  });

  test('returnTo keeps app locations only', () {
    final cases = <String?, String>{
      null: '/account',
      '': '/account',
      '/account/walks': '/account/walks',
      '/walk?id=123e4567-e89b-42d3-a456-426614174000': '/walk?id=123e4567-e89b-42d3-a456-426614174000',
      '/': '/',
      '/login': '/account',
      '/admin': '/account',
      '//evil.example/account': '/account',
      'https://evil.example/account': '/account',
      'account': '/account',
      '/\\evil.example': '/account',
      '/account\n': '/account',
    };
    for (final MapEntry(:key, :value) in cases.entries) {
      expect(safeReturnTo(key), value, reason: '$key');
    }
  });
}
