import 'package:flutter/widgets.dart';

import '../../core/api/api_error.dart';
import '../../core/i18n/i18n.dart';
import '../../core/i18n/translations.dart';
import '../offline/offline_packs.dart';

final _russian = RegExp('[А-Яа-яЁё]');

/// Site `toUserMessage`: a Russian error text is shown as is in Russian and translated when the
/// dictionary knows it; anything else (unknown server wording, runtime details) becomes [fallback],
/// which the caller passes already translated.
String userMessage(BuildContext context, Object error, String fallback) {
  final message = switch (error) {
    ApiError(:final message) => message,
    FormatException(:final message) => message,
    StateError(:final message) => message,
    OfflinePackError(:final message) => message,
    _ => '',
  };
  if (message.isEmpty || !_russian.hasMatch(message)) return fallback;
  final i18n = I18n.of(context);
  if (i18n.locale == AppLocale.ru) return message;
  return i18n.translations.has(message) ? i18n.t(message) : fallback;
}
