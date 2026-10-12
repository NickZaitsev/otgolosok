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
};

export function historicalWalkPhotos(walkId: string, stopId: string) { return HISTORICAL_WALK_PHOTOS[`${walkId}:${stopId}`] ?? []; }
