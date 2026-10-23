// A pure-Dart approximation of `a.localeCompare(b, "ru")` (ICU, CLDR root
// collation with Cyrillic reordered before Latin). dart:core has no collator.
//
// Covered: three strength levels (base letter, diacritic, case with lower
// case first); spaces and punctuation before digits before letters; Cyrillic
// before Latin before other scripts; «ё» sorts as «е» with a diacritic
// difference; common Latin letters with diacritics sort with their base letter.
// Not covered: contractions and expansions of other languages, ignorable
// characters, full Unicode collation weights for other scripts (they sort by
// code point after Latin).

const Map<String, String> _latinAccents = {
  'a': 'àáâãäåāăą',
  'A': 'ÀÁÂÃÄÅĀĂĄ',
  'c': 'çćč',
  'C': 'ÇĆČ',
  'e': 'èéêëēėęě',
  'E': 'ÈÉÊËĒĖĘĚ',
  'i': 'ìíîïī',
  'I': 'ÌÍÎÏĪ',
  'n': 'ñń',
  'N': 'ÑŃ',
  'o': 'òóôõöøōő',
  'O': 'ÒÓÔÕÖØŌŐ',
  's': 'śš',
  'S': 'ŚŠ',
  'u': 'ùúûüūů',
  'U': 'ÙÚÛÜŪŮ',
  'y': 'ýÿ',
  'Y': 'ÝŸ',
  'z': 'źżž',
  'Z': 'ŹŻŽ',
};

/// Accented Latin letter → its base letter.
final Map<int, int> _latinBase = {
  for (final entry in _latinAccents.entries)
    for (final rune in entry.value.runes) rune: entry.key.codeUnitAt(0),
};

class _Weights {
  _Weights(this.primary, this.secondary, this.tertiary);

  final List<int> primary;
  final List<int> secondary;
  final List<int> tertiary;
}

const int _groupSpace = 1 << 24;
const int _groupPunctuation = 2 << 24;
const int _groupDigit = 3 << 24;
const int _groupCyrillic = 4 << 24;
const int _groupLatin = 5 << 24;
const int _groupOther = 6 << 24;

bool _isSpace(int rune) =>
    rune == 0x20 || (rune >= 0x09 && rune <= 0x0d) || rune == 0xa0 || rune == 0x2028 || rune == 0x2029 ||
    (rune >= 0x2000 && rune <= 0x200a) || rune == 0x3000;

_Weights _weigh(String text) {
  final primary = <int>[];
  final secondary = <int>[];
  final tertiary = <int>[];
  for (var rune in text.runes) {
    var accent = 0;
    var upper = 0;
    int group;
    // Cyrillic: а..я (U+0430..U+044F) are in alphabetical order; ё goes with е.
    if (rune >= 0x0400 && rune <= 0x04ff) {
      if (rune >= 0x0410 && rune <= 0x042f) {
        upper = 1;
        rune += 0x20;
      } else if (rune >= 0x0400 && rune <= 0x040f) {
        upper = 1;
        rune += 0x50;
      }
      if (rune == 0x0451) {
        rune = 0x0435;
        accent = 1;
      }
      group = _groupCyrillic;
    } else if (_latinBase.containsKey(rune) ||
        (rune >= 0x41 && rune <= 0x5a) ||
        (rune >= 0x61 && rune <= 0x7a)) {
      final base = _latinBase[rune];
      if (base != null) {
        accent = rune;
        rune = base;
      }
      if (rune >= 0x41 && rune <= 0x5a) {
        upper = 1;
        rune += 0x20;
      }
      group = _groupLatin;
    } else if (rune >= 0x30 && rune <= 0x39) {
      group = _groupDigit;
    } else if (_isSpace(rune)) {
      group = _groupSpace;
    } else if (rune < 0x80 || (rune >= 0x2010 && rune <= 0x205e) || (rune >= 0xa1 && rune <= 0xbf)) {
      group = _groupPunctuation;
    } else {
      group = _groupOther;
    }
    primary.add(group + rune);
    secondary.add(accent);
    tertiary.add(upper);
  }
  return _Weights(primary, secondary, tertiary);
}

int _compareLists(List<int> left, List<int> right) {
  final length = left.length < right.length ? left.length : right.length;
  for (var index = 0; index < length; index += 1) {
    final difference = left[index] - right[index];
    if (difference != 0) return difference < 0 ? -1 : 1;
  }
  return left.length == right.length ? 0 : (left.length < right.length ? -1 : 1);
}

/// Negative, zero or positive like `left.localeCompare(right, "ru")`.
int compareRussian(String left, String right) {
  if (left == right) return 0;
  final a = _weigh(left);
  final b = _weigh(right);
  final primary = _compareLists(a.primary, b.primary);
  if (primary != 0) return primary;
  final secondary = _compareLists(a.secondary, b.secondary);
  if (secondary != 0) return secondary;
  return _compareLists(a.tertiary, b.tertiary);
}
