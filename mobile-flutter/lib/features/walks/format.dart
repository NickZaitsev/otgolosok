import '../../core/i18n/translations.dart';

/// Russian plural categories of `Intl.PluralRules("ru")` for whole numbers.
enum RuPlural { one, few, many }

RuPlural ruPlural(int count) {
  final value = count.abs();
  final last = value % 10, tens = value % 100;
  if (last == 1 && tens != 11) return RuPlural.one;
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return RuPlural.few;
  return RuPlural.many;
}

/// `number.toLocaleString(tag, {minimumFractionDigits: d, maximumFractionDigits: d})` for the
/// app languages: a decimal comma in Russian, a point in English and Chinese; thousands are grouped
/// with a narrow space (ru) or a comma (en, zh), as `Intl.NumberFormat` does.
String formatFixed(double value, AppLocale locale, {int digits = 1}) {
  final fixed = value.abs().toStringAsFixed(digits);
  final parts = fixed.split('.');
  final grouped = _group(parts[0], locale == AppLocale.ru ? ' ' : ',');
  final sign = value < 0 && double.parse(fixed) != 0 ? '-' : '';
  if (digits == 0) return '$sign$grouped';
  return '$sign$grouped${locale == AppLocale.ru ? ',' : '.'}${parts[1]}';
}

/// `toLocaleString(tag, {maximumFractionDigits: 1})`: trailing zeros dropped.
String formatUpToOne(double value, AppLocale locale) {
  final text = formatFixed(value, locale);
  final separator = locale == AppLocale.ru ? ',' : '.';
  return text.endsWith('${separator}0') ? text.substring(0, text.length - 2) : text;
}

String _group(String digits, String separator) {
  // Intl groups Russian numbers only from five digits on («1000», «10 000»).
  if (digits.length < 4 || (separator == ' ' && digits.length < 5)) return digits;
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write(separator);
    buffer.write(digits[i]);
  }
  return buffer.toString();
}
