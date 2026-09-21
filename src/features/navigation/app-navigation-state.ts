export type NavigationSection = "nearby" | "create" | "account";

export function navigationSection(pathname: string): NavigationSection | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "/") return "nearby";
  if (normalized === "/walk" || normalized === "/create") return "create";
  if (normalized === "/account") return "account";
  return null;
}
