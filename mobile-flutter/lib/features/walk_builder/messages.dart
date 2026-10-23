import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../../core/api/api_error.dart';
import '../../core/location/locate.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../../core/i18n/user_message.dart';

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
  const LocateFailureText(this.reason);

  final LocateError reason;

  /// The Russian source of [reason].
  String get source => describeLocateError(reason);

  @override
  String resolve(BuildContext context) => '${context.t(source)} ${context.t('Выберите точку на карте или введите адрес.')}';
}

const _placeBusy = 'Подождите секунду и повторите поиск.';

/// The Russian source to show for [error]: the shared [userMessageSource], plus the builder's own
/// text for a busy address search.
String errorSource(Object error, String fallback, {required AppLocale locale, required bool Function(String source) known}) =>
    error is ApiError && error.code == 'PLACE_BUSY' ? _placeBusy : userMessageSource(error, fallback, locale: locale, known: known);
