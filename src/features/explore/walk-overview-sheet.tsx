"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { Sheet } from "../shell/sheet";
import { formatRatingSummary } from "../reviews/model";
import { formatTopWalkMeta, topWalkHref } from "../walks/top-model";
import { useI18n } from "@/lib/i18n/provider";
import { ExploreIcon } from "./icons";
import { walkColorIndex, type MapWalk } from "./walk-overview";
import a from "./around.module.css";
import styles from "./walk-overview-sheet.module.css";

const swatch = (walk: MapWalk) => ({ "--walk-color": `var(--walk-overview-${walkColorIndex(walk.key)})` }) as CSSProperties;

function WalkDetails({ walk }: { walk: MapWalk }) {
  const { locale, t } = useI18n();
  const rating = formatRatingSummary(walk.rating, locale);
  return <span className={styles.meta}>{formatTopWalkMeta(walk, locale)}{" · "}{rating || t("Пока без оценок")}</span>;
}

function OpenWalk({ walk, onOpen }: { walk: MapWalk; onOpen: () => void }) {
  const { path, t } = useI18n();
  return <Link className={a.primary} href={path(topWalkHref(walk))} prefetch={false} onClick={onOpen}>{t("Открыть прогулку")} <ExploreIcon name="arrow" /></Link>;
}

/**
 * The walks under a tap on their overview lines. One walk shows its card at once; where several
 * lines meet, they are listed nearest first and the chosen one is highlighted on the map.
 */
export function WalkOverviewSheet({ walks, selected, onSelect, onOpen, onClose }: {
  walks: MapWalk[]; selected: string | null; onSelect: (key: string) => void; onOpen: () => void; onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const single = walks.length === 1 ? walks[0] : null;
  const lang = locale === "ru" ? undefined : "ru";
  return <Sheet name="walk-overview" labelledBy="walk-overview-title"
    header={<div className={a.headerRow}>
      <div>
        <span className={a.label}>{single ? t("Прогулка") : t("Прогулок здесь: {count}", { count: walks.length })}</span>
        <h2 id="walk-overview-title" className={a.title} lang={single ? lang : undefined}>{single ? single.title : t("Выберите прогулку")}</h2>
      </div>
      <button type="button" className={a.iconButton} aria-label={t("Закрыть карточку")} onClick={onClose}><ExploreIcon name="close" /></button>
    </div>}
    footer={single ? <OpenWalk walk={single} onOpen={onOpen} /> : undefined}>
    {single ? <p className={styles.single} style={swatch(single)}><WalkDetails walk={single} /></p>
      : <ul className={styles.list}>{walks.map(walk => {
        const chosen = walk.key === selected;
        return <li key={walk.key} style={swatch(walk)} data-selected={chosen}>
          <button type="button" className={styles.choice} aria-pressed={chosen} onClick={() => onSelect(walk.key)}>
            <strong lang={lang}>{walk.title}</strong>
            <WalkDetails walk={walk} />
          </button>
          {chosen ? <OpenWalk walk={walk} onOpen={onOpen} /> : null}
        </li>;
      })}</ul>}
  </Sheet>;
}
