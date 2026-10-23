// JSON text exactly as JavaScript's JSON.stringify writes it. The site's
// validators compare and measure JSON.stringify output (document size limits,
// unchanged source documents), and Dart's jsonEncode differs in number
// formatting (`30.0` vs `30`, `-0.0` vs `0`) and escaping of lone surrogates.

const int _maxSafeInteger = 9007199254740991;

/// `String(value)` of a JavaScript number, as JSON.stringify prints it.
/// Non-finite numbers become `null`, like JSON.stringify does.
String jsNumberToString(num value) {
  if (value is int) {
    if (value.abs() <= _maxSafeInteger) return value.toString();
    value = value.toDouble();
  }
  final number = value.toDouble();
  if (!number.isFinite) return 'null';
  if (number == 0) return '0';
  final text = number.toString();
  // Dart writes integral doubles below 1e21 with a trailing ".0"; JavaScript does not.
  return text.endsWith('.0') ? text.substring(0, text.length - 2) : text;
}

/// JSON.stringify(value) for decoded JSON values (null, bool, num, String, List, Map).
String jsJsonStringify(Object? value) {
  final buffer = StringBuffer();
  _write(buffer, value);
  return buffer.toString();
}

void _write(StringBuffer out, Object? value) {
  if (value == null) {
    out.write('null');
  } else if (value is bool) {
    out.write(value ? 'true' : 'false');
  } else if (value is num) {
    out.write(jsNumberToString(value));
  } else if (value is String) {
    _writeString(out, value);
  } else if (value is List<Object?>) {
    out.write('[');
    for (var index = 0; index < value.length; index += 1) {
      if (index > 0) out.write(',');
      _write(out, value[index]);
    }
    out.write(']');
  } else if (value is Map<String, Object?>) {
    out.write('{');
    var first = true;
    for (final entry in value.entries) {
      if (!first) out.write(',');
      first = false;
      _writeString(out, entry.key);
      out.write(':');
      _write(out, entry.value);
    }
    out.write('}');
  } else {
    throw ArgumentError.value(value, 'value', 'Not a JSON value');
  }
}

String _hex4(int unit) => unit.toRadixString(16).padLeft(4, '0');

void _writeString(StringBuffer out, String text) {
  out.write('"');
  final units = text.codeUnits;
  for (var index = 0; index < units.length; index += 1) {
    final unit = units[index];
    switch (unit) {
      case 0x22:
        out.write(r'\"');
      case 0x5c:
        out.write(r'\\');
      case 0x08:
        out.write(r'\b');
      case 0x0c:
        out.write(r'\f');
      case 0x0a:
        out.write(r'\n');
      case 0x0d:
        out.write(r'\r');
      case 0x09:
        out.write(r'\t');
      default:
        if (unit < 0x20) {
          out.write('\\u${_hex4(unit)}');
        } else if (unit >= 0xd800 && unit <= 0xdbff) {
          final low = index + 1 < units.length ? units[index + 1] : -1;
          if (low >= 0xdc00 && low <= 0xdfff) {
            out.writeCharCode(unit);
            out.writeCharCode(low);
            index += 1;
          } else {
            out.write('\\u${_hex4(unit)}');
          }
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
          out.write('\\u${_hex4(unit)}');
        } else {
          out.writeCharCode(unit);
        }
    }
  }
  out.write('"');
}
