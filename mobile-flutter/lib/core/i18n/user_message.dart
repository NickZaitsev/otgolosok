// Port of the site's `toUserMessage` (src/lib/errors/user-message.ts): the one way the app turns an
// error into text for the user.
import 'package:flutter/widgets.dart';

import '../api/api_error.dart';
import 'i18n.dart';
import 'translations.dart';

/// An exception whose [message] is a Russian source text written for the user.
abstract interface class UserFacingError implements Exception {
  String get message;
}

/// Russian sources of transport failures (site `USER_MESSAGES`); [ApiError] already uses them.
abstract final class UserMessages {
  static const network = 'Нет связи с сервером. Проверьте интернет и повторите попытку.';
  static const timeout = 'Сервер долго не отвечает. Повторите попытку.';
  static const aborted = 'Запрос прерван. Повторите попытку.';
  static const badResponse = 'Сервер вернул неожиданный ответ. Повторите попытку позже.';
  static const storageFull = 'На устройстве не хватает места. Освободите память и повторите попытку.';
}

/// Site `ERROR_CODE_MESSAGES`: texts for server codes whose message the dictionary does not know.
const _codeMessages = {
  'UNAUTHORIZED': 'Войдите в аккаунт.',
  'AUTH_REQUIRED': 'Войдите в аккаунт.',
  'CSRF': 'Обновите страницу и повторите действие.',
  'PASSWORD_INVALID': 'Неверный пароль.',
  'SERVICE_UNAVAILABLE': UserMessages.network,
};

final _russian = RegExp('[А-Яа-яЁё]');

/// The Russian source to show for [error] (site `toUserMessage`). Russian is the server contract:
/// the Russian interface shows any Russian message as is; another language shows only messages the
/// dictionary [known]s or a text for a known error code. Anything else, including raw runtime
/// details, becomes [fallback] (a Russian source too).
String userMessageSource(Object error, String fallback, {required AppLocale locale, required bool Function(String source) known}) {
  final message = switch (error) {
    UserFacingError(:final message) || ApiError(:final message) || FormatException(:final message) || StateError(:final message) => message,
    _ => '',
  };
  if (locale != AppLocale.ru) {
    if (message.isNotEmpty && known(message)) return message;
    final byCode = _codeMessages[error is ApiError ? error.code : null];
    if (byCode != null) return byCode;
  }
  if (_russian.hasMatch(message)) return locale == AppLocale.ru ? message : fallback;
  return fallback;
}

/// [userMessageSource] in the current interface language; [fallback] is a Russian source.
String userMessage(BuildContext context, Object error, String fallback) {
  final i18n = I18n.of(context);
  return i18n.t(userMessageSource(error, fallback, locale: i18n.locale, known: i18n.translations.has));
}
