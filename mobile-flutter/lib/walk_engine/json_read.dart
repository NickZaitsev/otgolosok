// Typed reads of decoded JSON. A wrong type is a FormatException, never a
// TypeError, so callers can fail closed on any malformed payload.
import 'distance.dart';

const String _message = 'Некорректные данные прогулки.';

Never failFormat([String message = _message]) =>
    throw FormatException(message);

Map<String, Object?> readMap(Object? value) =>
    value is Map<String, Object?> ? value : failFormat();

List<Object?> readList(Object? value) =>
    value is List<Object?> ? value : failFormat();

String readString(Object? value) => value is String ? value : failFormat();

bool readBool(Object? value) => value is bool ? value : failFormat();

double readDouble(Object? value) =>
    value is num && value.isFinite ? value.toDouble() : failFormat();

int readInt(Object? value) =>
    jsIsInteger(value) ? (value! as num).toInt() : failFormat();

GeoPoint readPoint(Object? value) {
  final map = readMap(value);
  return GeoPoint(readDouble(map['lat']), readDouble(map['lon']));
}

T readEnum<T>(List<T> values, Object? value, String Function(T item) wire) {
  for (final item in values) {
    if (wire(item) == value) return item;
  }
  return failFormat();
}

/// `fields(value, allowed)` of the site validators: a plain object whose keys
/// are all allowed. Missing keys are allowed; callers check them.
bool jsFields(Object? value, List<String> allowed) =>
    value is Map<String, Object?> && value.keys.every(allowed.contains);

/// `Number.isInteger`.
bool jsIsInteger(Object? value) =>
    value is int ||
    (value is double && value.isFinite && value == value.truncateToDouble());

/// `Number.isSafeInteger`.
bool jsIsSafeInteger(Object? value) =>
    jsIsInteger(value) && (value! as num).abs() <= 9007199254740991;

/// `Math.round` (halves round up, also for negative numbers).
int jsRound(double value) {
  final floor = value.floorToDouble();
  return (value - floor >= 0.5 ? floor + 1 : floor).toInt();
}
