"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { ExploreMap } from "../explore/explore-map";
import { MapAttribution } from "../shell/map-attribution";
import { MapStatusNotice, type MapStatus } from "../shell/map-status-notice";
import type { Coordinates, WalkPlan } from "./types";
import type { WalkChapter } from "./walk-plan";
import styles from "./walk-map.module.css";

const noop = () => {};

function distanceLabel(meters: number | null, languageTag: string, t: (source: string, values?: Record<string, string | number>) => string) {
  if (meters === null || !Number.isFinite(meters)) return null;
  return meters < 1000
    ? t("{distance} м", { distance: Math.max(10, Math.round(meters / 10) * 10).toLocaleString(languageTag) })
    : t("{distance} км", { distance: (meters / 1000).toLocaleString(languageTag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}

export function WalkMap({ chapters, index, path, user, distanceToNextM, onSelect }: {
  chapters: WalkChapter[];
  index: number;
  path: WalkPlan["path"] | undefined;
  user: (Coordinates & { accuracyM: number }) | null;
  distanceToNextM: number | null;
  onSelect: (index: number) => void;
}) {
  const { languageTag, t } = useI18n();
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<MapStatus>({ phase: "loading", tilesOffline: false });
  // Route geometry is stored in GeoJSON order, longitude first.
  const geometry = useMemo(
    () => (path?.coordinates ?? []).flatMap(([lon, lat]) => Number.isFinite(lat) && Number.isFinite(lon) ? [{ lat, lon }] : []),
    [path],
  );
  const items = useMemo(
    () => chapters.map((chapter, position) => ({
      id: chapter.id,
      title: t("Часть {number}: {title}. {place}", { number: position + 1, title: chapter.title, place: chapter.place }),
      location: chapter.trigger_location ?? chapter.location,
      number: position + 1,
    })),
    [chapters, t],
  );
  if (!chapters.length) return null;
  const next = chapters[index + 1];
  const distance = distanceLabel(distanceToNextM, languageTag, t);

  return <section className="walk-map" aria-labelledby="walk-map-title">
    <div className="walk-map-head">
      <h2 id="walk-map-title">{t("Где вы")}</h2>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {t(open ? "Скрыть карту" : "Показать карту")}
      </button>
    </div>
    {open ? <div className={`walk-map-canvas ${styles.canvas}`}>
      <ExploreMap onStatus={setStatus} items={items} selectedId={chapters[index]?.id} focus={null} user={user}
        geometry={geometry.length > 1 ? geometry : undefined} onSelect={(id) => {
          const position = chapters.findIndex((chapter) => chapter.id === id);
          if (position >= 0) onSelect(position);
        }} onPoint={noop}
        mapLabel={t("Карта прогулки: линия пути, отметки частей по порядку и ваше положение. Нажмите отметку, чтобы слушать эту часть.")} />
      <div className={styles.overlay}>
        <MapStatusNotice status={status} />
        <div className={styles.row}>
          <MapAttribution />
        </div>
      </div>
    </div> : null}
    <p className="walk-map-next" role="status">
      {next
        ? <>{t("Дальше: {number}. {title}", { number: index + 2, title: next.title })}{distance ? <> · {t("{distance} по прямой", { distance })}</> : null}</>
        : <>{t("Финиш: {place}", { place: chapters[index]?.place ?? "" })}</>}
    </p>
  </section>;
}
