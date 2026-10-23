import 'package:flutter/widgets.dart';

import '../../core/api/api_error.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import 'auth_repository.dart';

/// Russian sources for transport failures (site `USER_MESSAGES`, src/lib/errors/user-message.ts).
abstract final class UserMessages {
  static const network = 'Нет связи с сервером. Проверьте интернет и повторите попытку.';
  static const timeout = 'Сервер долго не отвечает. Повторите попытку.';
  static const badResponse = 'Сервер вернул неожиданный ответ. Повторите попытку позже.';
}

const _codeMessages = {
  'UNAUTHORIZED': 'Войдите в аккаунт.',
  'AUTH_REQUIRED': 'Войдите в аккаунт.',
  'CSRF': 'Обновите страницу и повторите действие.',
  'PASSWORD_INVALID': 'Неверный пароль.',
};

final _russian = RegExp('[А-Яа-яЁё]');

/// The Russian source to show for [error], like the site's `toUserMessage`: known server messages
/// are kept, unknown ones only in the Russian interface, anything else becomes [fallback].
String userMessageSource(Object error, String fallback, {required AppLocale locale, required bool Function(String) known}) {
  if (error is AuthFailure) return error.message;
  if (error is! ApiError) return fallback;
  switch (error.code) {
    case 'NETWORK':
      return UserMessages.network;
    case 'TIMEOUT':
      return UserMessages.timeout;
    case 'CORRUPT':
      return UserMessages.badResponse;
  }
  if (known(error.message)) return error.message;
  final byCode = _codeMessages[error.code];
  if (byCode != null) return byCode;
  if (locale == AppLocale.ru && _russian.hasMatch(error.message)) return error.message;
  return fallback;
}

/// [userMessageSource] translated into the current UI language.
String userMessage(BuildContext context, Object error, String fallback) {
  final i18n = I18n.of(context);
  return i18n.t(userMessageSource(error, fallback, locale: i18n.locale, known: i18n.translations.has));
}
