"use client";

import Link from "next/link";
import { formatNearbyWalkMeta, isOwnNearbyWalk, nearbyWalkHref, type NearbyWalk } from "../walks/nearby-model";
import styles from "./nearby-walks.module.css";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";

export function formatLocalizedNearbyWalkMeta(walk: Pick<NearbyWalk, "distanceM" | "stopCount" | "audioMinutes" | "audioComplete">, locale: Locale = "ru") {
  if (locale === "ru") return formatNearbyWalkMeta(walk);
  const km = (walk.distanceM / 1000).toLocaleString(locale === "zh" ? "zh-CN" : "en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const points = translate(locale, "{count} точек", { count: walk.stopCount });
  let audio = translate(locale, "нет данных об озвучке");
  if (walk.audioMinutes !== undefined) {
    if (walk.audioMinutes === 0) audio = translate(locale, "Озвучка пока не готова");
    else audio = translate(locale, walk.audioComplete === false ? "{minutes} мин готовой озвучки" : "{minutes} мин озвучки", { minutes: walk.audioMinutes });
  }
  return translate(locale, "Осталось {km} км · {points} · {audio}", { km, points, audio });
}

/**
 * Ready walks passing near the chosen start, or near the user before a start is chosen: the user
 * can go on one instead of building a new walk. Collapsed by default so the creation sheet stays
 * low; the summary shows how many there are.
 */
export function NearbyWalks({ walks, origin }: { walks: NearbyWalk[]; origin: "start" | "you" }) {
  const { locale, path, t } = useI18n();
  return <details className={styles.section} data-creation="nearby">
    <summary className={styles.summary}>{t(origin === "you" ? "Близко к вам" : "Прогулки рядом")} · {walks.length}</summary>
    <ol className={styles.list}>
      {walks.map(walk => <li key={`${walk.kind}:${walk.id}`}>
        <Link className={styles.card} href={path(nearbyWalkHref(walk))}>
          <span className={styles.titleRow}>
            <strong className={styles.title}>{walk.title}</strong>
            {isOwnNearbyWalk(walk) && <span className={styles.badge}>{t("Ваша")}</span>}
          </span>
          <span className={styles.meta}>{formatLocalizedNearbyWalkMeta(walk, locale)}</span>
        </Link>
      </li>)}
    </ol>
  </details>;
}
