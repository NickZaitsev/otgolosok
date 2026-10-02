"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackPage } from "./metrika";

export function YandexMetrika() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    if (process.env.NODE_ENV === "production") trackPage(window.location.href);
  }, [pathname, search]);

  return null;
}
