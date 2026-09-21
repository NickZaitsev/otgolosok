export type NavigationSection = "nearby" | "walk" | "account";

export function navigationSection(pathname: string): NavigationSection | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "/") return "nearby";
  if (normalized === "/walk") return "walk";
  if (normalized === "/account") return "account";
  return null;
}
