/// Field rules of the site form (src/features/auth/login.tsx): the browser's `type=email`,
/// `minLength=10`/`maxLength=128` for the password and `maxLength=80` for the name.
/// Every function returns a Russian source message, or null when the value is valid.
library;

const passwordMin = 10;
const passwordMax = 128;
const nameMax = 80;

// The WHATWG "valid e-mail address" rule that `<input type=email>` applies.
final _email = RegExp(
  r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$",
);

String? validateEmail(String value) {
  final email = value.trim();
  if (email.isEmpty) return 'Введите email.';
  if (!_email.hasMatch(email)) return 'Проверьте адрес email.';
  return null;
}

String? validatePassword(String value) {
  if (value.isEmpty) return 'Введите пароль.';
  if (value.length < passwordMin || value.length > passwordMax) return 'Пароль должен содержать от 10 до 128 символов.';
  return null;
}

String? validateName(String value) {
  final name = value.trim();
  if (name.isEmpty) return 'Введите имя.';
  if (name.length > nameMax) return 'Имя должно быть не длиннее 80 символов.';
  return null;
}

/// Where to go after sign-in: an app location, like the site's `safeReturnTo`, else `/account`.
String safeReturnTo(String? value) {
  const fallback = '/account';
  if (value == null || value.isEmpty || RegExp(r'[\u0000-\u001f\u007f\\]').hasMatch(value)) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  final uri = Uri.tryParse(value);
  if (uri == null || uri.hasScheme || uri.hasAuthority) return fallback;
  const allowed = {'/', '/account', '/account/walks', '/walk', '/builder', '/trends', '/history'};
  if (!allowed.contains(uri.path)) return fallback;
  return uri.toString();
}
