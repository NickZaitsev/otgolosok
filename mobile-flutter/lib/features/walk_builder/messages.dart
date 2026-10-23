import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../../core/api/api_error.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import 'model.dart';
import 'walk_document.dart';

/// A text the builder shows; kept as a Russian source and translated when drawn, so a language
/// switch never leaves stale text behind.
sealed class UiText {
  const UiText();

  String resolve(BuildContext context);
}

class Phrase extends UiText {
  const Phrase(this.source, [this.values = const {}]);

  final String source;
  final Map<String, Object> values;

  @override
  String resolve(BuildContext context) => context.t(source, values);

  @override
  bool operator ==(Object other) => other is Phrase && other.source == source && mapEquals(other.values, values);

  @override
  int get hashCode => Object.hash(source, Object.hashAllUnordered(values.entries.map((entry) => Object.hash(entry.key, entry.value))));

  @override
  String toString() => source;
}

/// An error shown like the site's `toUserMessage(error, fallback)`, optionally inside [template]
/// (a source with an `{error}` placeholder).
class ErrorText extends UiText {
  const ErrorText(this.error, this.fallback, {this.template});

  final Object error;
  final String fallback;
  final String? template;

  @override
  String resolve(BuildContext context) {
    final i18n = I18n.of(context);
    final text = i18n.t(errorSource(error, fallback, locale: i18n.locale, known: i18n.translations.has));
    return template == null ? text : i18n.t(template!, {'error': text});
  }

  @override
  String toString() => '$template: $error / $fallback';
}

/// Why «Моё местоположение» failed, followed by what to do instead.
class LocateFailureText extends UiText {
  const LocateFailureText(this.source);

  final String source;

  @override
  String resolve(BuildContext context) => '${context.t(source)} ${context.t('Выберите точку на карте или введите адрес.')}';
}

/// Transport failures in the site's words (`USER_MESSAGES`).
const _network = 'Нет связи с сервером. Проверьте интернет и повторите попытку.';
const _timeout = 'Сервер долго не отвечает. Повторите попытку.';
const _badResponse = 'Сервер вернул неожиданный ответ. Повторите попытку позже.';

const _byCode = {
  'UNAUTHORIZED': 'Войдите в аккаунт.',
  'AUTH_REQUIRED': 'Войдите в аккаунт.',
  'CSRF': 'Обновите страницу и повторите действие.',
  'PLACE_BUSY': 'Подождите секунду и повторите поиск.',
};

final _russian = RegExp('[А-Яа-яЁё]');

/// The Russian source to show for [error]: a known or (in Russian) any Russian message of the
/// error, a message by its code, otherwise [fallback]. Raw runtime details never reach the UI.
String errorSource(Object error, String fallback, {required AppLocale locale, required bool Function(String source) known}) {
  final String message;
  String? code;
  switch (error) {
    case ApiError():
      switch (error.code) {
        case 'NETWORK':
          return _network;
        case 'TIMEOUT':
          return _timeout;
        case 'CORRUPT':
          return _badResponse;
        case 'PLACE_BUSY':
          return _byCode['PLACE_BUSY']!;
      }
      message = error.message;
      code = error.code;
    case ModelError(message: final text) || FormatException(message: final text) || StateError(message: final text):
      message = text;
    case InvalidWalkDocument():
      message = error.message;
    default:
      return fallback;
  }
  if (known(message)) return message;
  final byCode = _byCode[code];
  if (byCode != null) return byCode;
  if (locale == AppLocale.ru && _russian.hasMatch(message)) return message;
  return fallback;
}

