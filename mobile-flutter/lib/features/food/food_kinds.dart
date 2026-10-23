// Port of src/features/food/food-kinds.ts: map groups, labels and cuisines of food places. Labels are Russian
// source strings, translated by the widget with `context.t`.
import 'dart:ui' show Color;

import '../../app/theme/tokens.g.dart';
import 'food_model.dart';

/// A map group of food kinds with its legend [label], map [icon] (shipped as `assets/map/icons/poi-<icon>.png`) and
/// marker [color], which keeps white glyphs at a contrast of at least 4.5:1.
enum FoodGroup {
  coffee('Кофейни', 'foodCoffee', TokenColors.muted),
  meal('Кафе и рестораны', 'foodMeal', TokenColors.teal),
  snack('Перекус', 'foodSnack', TokenColors.mapOrange),
  bar('Бары и пабы', 'foodBar', TokenColors.mapGreen);

  const FoodGroup(this.label, this.icon, this.color);

  final String label;
  final String icon;
  final Color color;

  /// The map style image name, as the explore map registers its POI icons.
  String get mapImage => 'poi-$icon';

  String get asset => 'assets/map/icons/$mapImage.png';

  List<FoodKind> get kinds => [for (final kind in FoodKind.values) if (foodGroup(kind) == this) kind];
}

FoodGroup foodGroup(FoodKind kind) => switch (kind) {
      FoodKind.coffee => FoodGroup.coffee,
      FoodKind.cafe || FoodKind.restaurant => FoodGroup.meal,
      FoodKind.fastFood || FoodKind.bakery => FoodGroup.snack,
      FoodKind.bar => FoodGroup.bar,
    };

String foodKindLabel(FoodKind kind) => switch (kind) {
      FoodKind.coffee => 'Кофейня',
      FoodKind.cafe => 'Кафе',
      FoodKind.restaurant => 'Ресторан',
      FoodKind.fastFood => 'Быстрое питание',
      FoodKind.bakery => 'Пекарня',
      FoodKind.bar => 'Бар или паб',
    };

const _cuisines = {
  'coffee_shop': 'Кофе', 'pizza': 'Пицца', 'burger': 'Бургеры', 'sushi': 'Суши', 'russian': 'Русская кухня', 'georgian': 'Грузинская кухня',
  'italian': 'Итальянская кухня', 'japanese': 'Японская кухня', 'asian': 'Азиатская кухня', 'chinese': 'Китайская кухня', 'uzbek': 'Узбекская кухня',
  'bakery': 'Выпечка', 'ice_cream': 'Мороженое', 'shawarma': 'Шаурма', 'kebab': 'Кебаб', 'turkish': 'Турецкая кухня', 'indian': 'Индийская кухня',
  'korean': 'Корейская кухня', 'vietnamese': 'Вьетнамская кухня', 'thai': 'Тайская кухня', 'mexican': 'Мексиканская кухня', 'french': 'Французская кухня',
  'american': 'Американская кухня', 'european': 'Европейская кухня', 'international': 'Международная кухня', 'regional': 'Местная кухня',
  'seafood': 'Морепродукты', 'fish': 'Рыба', 'steak_house': 'Стейки', 'grill': 'Гриль', 'chicken': 'Курица', 'sandwich': 'Сэндвичи', 'pancakes': 'Блины',
  'crepe': 'Блины', 'dessert': 'Десерты', 'cake': 'Торты', 'confectionery': 'Сладости', 'tea': 'Чай', 'doughnut': 'Пончики', 'noodles': 'Лапша',
};

/// Russian labels of the known tags of an OSM `cuisine` value, in order and without repeats. Unknown raw tags never
/// leak into the UI.
List<String> cuisineLabels(String? value) => {
      for (final tag in (value ?? '').split(';')) ?_cuisines[tag.trim().toLowerCase()],
    }.toList();

/// The category line of a place: kind, then cuisines; the widget translates each source and joins them with « · ».
List<String> foodCategorySources(FoodKind kind, String? cuisine) => [foodKindLabel(kind), ...cuisineLabels(cuisine)];
