import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' show Color;

import 'package:flutter_test/flutter_test.dart';
import 'package:otgolosok/app/theme/tokens.g.dart';
import 'package:otgolosok/features/food/food_kinds.dart';
import 'package:otgolosok/features/food/food_model.dart';

double _luminance(Color color) {
  double channel(double value) => value <= .04045 ? value / 12.92 : math.pow((value + .055) / 1.055, 2.4).toDouble();
  return channel(color.r) * .2126 + channel(color.g) * .7152 + channel(color.b) * .0722;
}

void main() {
  const groups = [
    (FoodKind.coffee, FoodGroup.coffee, 'Кофейни'),
    (FoodKind.cafe, FoodGroup.meal, 'Кафе и рестораны'),
    (FoodKind.restaurant, FoodGroup.meal, 'Кафе и рестораны'),
    (FoodKind.fastFood, FoodGroup.snack, 'Перекус'),
    (FoodKind.bakery, FoodGroup.snack, 'Перекус'),
    (FoodKind.bar, FoodGroup.bar, 'Бары и пабы'),
  ];
  for (final (kind, group, label) in groups) {
    test('${kind.wire} belongs to «$label» with a shipped icon and a white-glyph contrast ≥ 4.5:1', () {
      expect(foodGroup(kind), group);
      expect(group.label, label);
      expect(group.kinds, contains(kind));
      expect(File(group.asset).existsSync(), isTrue, reason: group.asset);
      expect((_luminance(TokenColors.onDark) + .05) / (_luminance(group.color) + .05), greaterThanOrEqualTo(4.5));
    });
  }

  test('every kind is in exactly one group', () {
    expect([for (final group in FoodGroup.values) ...group.kinds], unorderedEquals(FoodKind.values));
  });

  const cuisines = <(String?, List<String>)>[
    ('coffee_shop;pizza;burger;sushi', ['Кофе', 'Пицца', 'Бургеры', 'Суши']),
    (
      'russian;georgian;italian;japanese;asian;chinese;uzbek',
      ['Русская кухня', 'Грузинская кухня', 'Итальянская кухня', 'Японская кухня', 'Азиатская кухня', 'Китайская кухня', 'Узбекская кухня'],
    ),
    ('bakery;ice_cream;shawarma', ['Выпечка', 'Мороженое', 'Шаурма']),
    (' Pizza ;unknown;pizza', ['Пицца']),
    ('pancakes;crepe', ['Блины']),
    (null, []),
    ('', []),
    ('unknown', []),
    ('__proto__;constructor;toString', []),
  ];
  for (final (value, labels) in cuisines) {
    test('cuisine ${value == null ? 'null' : '"$value"'} without leaking unknown raw tags', () => expect(cuisineLabels(value), labels));
  }

  test('the category keeps the kind first and only known cuisines', () {
    expect(foodCategorySources(FoodKind.restaurant, 'georgian;unknown'), ['Ресторан', 'Грузинская кухня']);
    expect(foodCategorySources(FoodKind.coffee, 'unknown'), ['Кофейня']);
    expect(foodCategorySources(FoodKind.fastFood, null), ['Быстрое питание']);
  });
}
