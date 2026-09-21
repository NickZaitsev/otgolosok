"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExploreIcon } from "../explore/icons";
import { navigationSection, type NavigationSection } from "./app-navigation-state";
import "./app-navigation.css";

type Props = {
  active?: NavigationSection;
  embedded?: boolean;
  onNearby?: () => void;
};

export function AppNavigation({ active, embedded = false, onNearby }: Props) {
  const pathname = usePathname();
  const current = active ?? navigationSection(pathname);

  if (!embedded && (current === null || pathname === "/")) return null;

  const nearby = onNearby
    ? <button type="button" aria-current={current === "nearby" ? "page" : undefined} onClick={onNearby}><ExploreIcon name="map"/><span>Рядом</span></button>
    : <Link href="/" aria-current={current === "nearby" ? "page" : undefined}><ExploreIcon name="map"/><span>Рядом</span></Link>;
  const walk = <Link href="/walk" aria-current={current === "walk" ? "page" : undefined}><ExploreIcon name="walk"/><span>Прогулка</span></Link>;

  return <nav className={`app-navigation${embedded ? " around-nav" : " app-navigation--standalone"}`} aria-label="Основная навигация">
    {nearby}
    {walk}
    <Link href="/account" aria-current={current === "account" ? "page" : undefined}><ExploreIcon name="user"/><span>Кабинет</span></Link>
  </nav>;
}
