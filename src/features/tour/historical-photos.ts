export type HistoricalWalkPhoto = { cid: number; year: number; title: string; src: string };

const pastvu = (cid: number, year: number, title: string, file: string): HistoricalWalkPhoto => ({ cid, year, title, src: `https://img.pastvu.com/d/${file}` });

const PUSHKIN_SQUARE = [
  pastvu(1344568, 1901, "Контора Международного общества спальных вагонов на Страстном бульваре", "f/y/1/fy14mal6i5hhuvqjx2.jpg"),
  pastvu(681249, 1934, "Церковь Дмитрия Солунского", "w/s/n/wsnohkuzq2qpqaw7f8.jpg"),
  pastvu(1036442, 1968, "Пушкинская площадь", "v/z/v/vzvaspu7b7j2181xzy.jpg"),
];

const PRECHISTENSKIE_GATES = [
  pastvu(1005773, 1900, "Храм Христа Спасителя", "w/y/p/wyp2d0j53c3wfdmu6y.jpg"),
  pastvu(645200, 1910, "Московский трамвай у Пречистенских ворот", "4/y/j/4yjqx5famhhg89mlus.jpg"),
  pastvu(87222, 1968, "Метростроевская улица", "d/a/6/da6f21b789c2497c008841a7f197c411.jpg"),
];

const NATIONAL_HOTEL = [
  pastvu(1119022, 1930, "Швейцар возле гостиницы «Националь»", "1/h/z/1hzg4jhitwxqmlv5aq.jpg"),
  pastvu(7141, 1935, "Гостиница «Националь»", "8/1/c/81cb1527513bc30fd5913e3f9ab35072.jpg"),
  pastvu(4328, 1937, "Гостиница «Националь»", "a/8/a/a8ad9a7afa5cf86b8fab7667db974e50.jpg"),
];

const CENTRAL_TELEGRAPH = [
  pastvu(1370355, 1926, "Строительство Центрального телеграфа", "9/k/1/9k1we9k1s4c9a0vahb.png"),
  pastvu(988748, 1929, "Центральный телеграф: трубы пневматической почты", "d/n/z/dnzfvj4nw3jl4ntdyr.jpg"),
  pastvu(456294, 1953, "Центральный Московский телеграф", "w/4/t/w4thgk52w88qzia87g.png"),
];

const NIRNSEE_HOUSE = [
  pastvu(230, 1915, "Панорама с дома Нирнзее", "5/7/1/571e01127e0499118ca9ec5ff0de69e6.jpg"),
  pastvu(19906, 1926, "Ресторан «Крыша» на доме Нирнзее", "5/6/f/56f4b0676a9acfbb3de708ca0d192958.jpg"),
  pastvu(87944, 1951, "На крыше дома Нирнзее", "a/a/f/aaf1d800210a659d5d2b840e85ee95c1.jpg"),
];

const LENKOM = [
  pastvu(154120, 1910, "Купеческое собрание: зрительный зал и сцена", "b/3/g/b3gsbokqdmr0usdoci.jpg"),
  pastvu(69091, 1914, "Лазарет в театре Купеческого клуба", "b/1/9/b19f44322be7bc1fc8e97e50c5497919.jpg"),
  pastvu(2605780, 1948, "Возле Театра имени Ленинского комсомола", "q/y/k/qykogqzoxpeyq3vmhk.jpg"),
];

/**
 * Подборки для опубликованных прогулок по ключу «id прогулки:id остановки».
 * Только id остановки не годится: они повторяются между прогулками (`tverskaya-stop-1` — и Пушкинская площадь,
 * и «Националь»), и снимки попадали к чужой точке.
 */
export const HISTORICAL_WALK_PHOTOS: Record<string, HistoricalWalkPhoto[]> = {
  // «По бульварному кольцу от Кропоткинской до Тверской»: площадь Пречистенские Ворота.
  "5295c72b-5d9f-4142-9d26-fb4f367b8865:boulevard-stop-1": PRECHISTENSKIE_GATES,
  // «По бульварному кольцу от Тверской до Трубной»: Пушкинская площадь.
  "0055eb13-d26d-4eab-b1f6-b25900bd7095:tverskaya-stop-1": PUSHKIN_SQUARE,
  // «Тверская: переезды домов и культурная жизнь»: Пушкинская площадь, Страстной монастырь и церковь Димитрия Солунского.
  "259d5970-d002-5dc4-b15f-b2a784c2dbb3:tverskaya-stop-10": PUSHKIN_SQUARE,
  "259d5970-d002-5dc4-b15f-b2a784c2dbb3:tverskaya-stop-1": NATIONAL_HOTEL,
  "259d5970-d002-5dc4-b15f-b2a784c2dbb3:tverskaya-stop-3": CENTRAL_TELEGRAPH,
  "259d5970-d002-5dc4-b15f-b2a784c2dbb3:tverskaya-stop-9": NIRNSEE_HOUSE,
  "259d5970-d002-5dc4-b15f-b2a784c2dbb3:tverskaya-stop-12": LENKOM,
};

export function historicalWalkPhotos(walkId: string, stopId: string) { return HISTORICAL_WALK_PHOTOS[`${walkId}:${stopId}`] ?? []; }
