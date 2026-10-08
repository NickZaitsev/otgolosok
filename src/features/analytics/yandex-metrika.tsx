"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackPage, stopMetrika } from "./metrika";
import { subscribeCookieChoice } from "../legal/cookie-consent";

export function YandexMetrika() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const update = () => trackPage(window.location.href);
    update();
    const unsubscribe = subscribeCookieChoice(update);
    const expiry = window.setInterval(update, 60_000);
    return () => { unsubscribe(); window.clearInterval(expiry); };
  }, [pathname, search]);

  useEffect(() => () => stopMetrika(), []);

  return null;
}
