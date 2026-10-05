export type HistoricalWalkPhoto = { cid: number; year: number; title: string; src: string };

const pastvu = (cid: number, year: number, title: string, file: string): HistoricalWalkPhoto => ({ cid, year, title, src: `https://img.pastvu.com/d/${file}` });

/** Первые подборки для опубликованных прогулок; источник всегда открыт рядом со снимком. */
export const HISTORICAL_WALK_PHOTOS: Record<string, HistoricalWalkPhoto[]> = {
  "tverskaya-stop-1": [
    pastvu(1344568, 1901, "Контора Международного общества спальных вагонов на Страстном бульваре", "f/y/1/fy14mal6i5hhuvqjx2.jpg"),
    pastvu(681249, 1934, "Церковь Дмитрия Солунского", "w/s/n/wsnohkuzq2qpqaw7f8.jpg"),
    pastvu(1036442, 1968, "Пушкинская площадь", "v/z/v/vzvaspu7b7j2181xzy.jpg"),
  ],
  "boulevard-stop-1": [
    pastvu(1005773, 1900, "Храм Христа Спасителя", "w/y/p/wyp2d0j53c3wfdmu6y.jpg"),
    pastvu(645200, 1910, "Московский трамвай у Пречистенских ворот", "4/y/j/4yjqx5famhhg89mlus.jpg"),
    pastvu(87222, 1968, "Метростроевская улица", "d/a/6/da6f21b789c2497c008841a7f197c411.jpg"),
  ],
};

export function historicalWalkPhotos(stopId: string) { return HISTORICAL_WALK_PHOTOS[stopId] ?? []; }
