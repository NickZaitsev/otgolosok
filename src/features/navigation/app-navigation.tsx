"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon } from "../ui/app-icon";
import { navigationSection, type NavigationSection } from "./app-navigation-state";
import "./app-navigation.css";

type Props = {
  active?: NavigationSection;
  embedded?: boolean;
  onNearby?: () => void;
  onWalk?: () => void;
};

export function AppNavigation({ active, embedded = false, onNearby, onWalk }: Props) {
  const pathname = usePathname();
  const current = active ?? navigationSection(pathname);

  if (!embedded && (current === null || pathname === "/")) return null;

  const nearby = onNearby
    ? <button type="button" aria-current={current === "nearby" ? "page" : undefined} onClick={onNearby}><AppIcon name="map"/><span>Рядом</span></button>
    : <Link href="/" aria-current={current === "nearby" ? "page" : undefined}><AppIcon name="map"/><span>Рядом</span></Link>;
  const walk = <Link href="/?walk=create" onClick={onWalk} aria-current={current === "walk" ? "page" : undefined}><AppIcon name="plus"/><span>Прогулка</span></Link>;

  return <nav className={`app-navigation${embedded ? " around-nav" : " app-navigation--standalone"}`} aria-label="Основная навигация">
    {nearby}
    {walk}
    <Link href="/history" aria-current={current === "history" ? "page" : undefined}><AppIcon name="walk"/><span>История</span></Link>
    <Link href="/account" aria-current={current === "account" ? "page" : undefined}><AppIcon name="user"/><span>Профиль</span></Link>
  </nav>;
}
