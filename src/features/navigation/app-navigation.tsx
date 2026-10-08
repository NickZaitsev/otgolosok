"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import { unlocalizedPath } from "@/lib/i18n/locale";
import { usePathname } from "next/navigation";
import { ExploreIcon } from "../explore/icons";
import { navigationSection, type NavigationSection } from "./app-navigation-state";
import { useNavigationHidden } from "./navigation-visibility";
import styles from "./app-navigation.module.css";

type Props = {
  active?: NavigationSection;
  /** Rendered by a screen that handles «Рядом» and «Прогулка» itself; otherwise the root layout renders it. */
  embedded?: boolean;
  onNearby?: () => void;
  onWalk?: () => void;
};

export function AppNavigation({ active, embedded = false, onNearby, onWalk }: Props) {
  const pathname = unlocalizedPath(usePathname());
  const { t, path } = useI18n();
  const current = active ?? navigationSection(pathname);
  const hidden = useNavigationHidden();

  if (hidden || (!embedded && (current === null || pathname === "/"))) return null;

  const nearby = onNearby
    ? <button type="button" aria-current={current === "nearby" ? "page" : undefined} onClick={onNearby}><ExploreIcon name="map"/><span>{t("Рядом")}</span></button>
    : <Link href={path("/")} aria-current={current === "nearby" ? "page" : undefined}><ExploreIcon name="map"/><span>{t("Рядом")}</span></Link>;
  const walk = <Link href={path("/?walk=create")} onClick={onWalk} aria-current={current === "walk" ? "page" : undefined}><ExploreIcon name="plus"/><span>{t("Прогулка")}</span></Link>;

  // Both render sites look the same: one island fixed above the bottom edge.
  return <nav className={styles.navigation} data-region="nav" aria-label={t("Основная навигация")}>
    {nearby}
    {walk}
    <Link href={path("/trends")} aria-current={current === "trends" ? "page" : undefined}><ExploreIcon name="trends"/><span>{t("Тренды")}</span></Link>
    <Link href={path("/account")} aria-current={current === "account" ? "page" : undefined}><ExploreIcon name="user"/><span>{t("Профиль")}</span></Link>
  </nav>;
}
