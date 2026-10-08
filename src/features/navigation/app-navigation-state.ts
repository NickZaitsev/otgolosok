import { unlocalizedPath } from "@/lib/i18n/locale";
export type NavigationSection = "nearby" | "walk" | "trends" | "account";

export function navigationSection(pathname: string): NavigationSection | null {
  pathname = unlocalizedPath(pathname);
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "/") return "nearby";
  if (normalized === "/walk") return "walk";
  if (normalized === "/history" || normalized === "/trends") return "trends";
  if (normalized === "/account" || normalized === "/account/walks" || normalized === "/login") return "account";
  return null;
}
