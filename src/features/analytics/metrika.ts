import { cookieChoice } from "../legal/cookie-consent";
import { unlocalizedPath } from "@/lib/i18n/locale";
import { LEGAL_READY } from "../../../legal/publication.mjs";

export const METRIKA_ID = 113326536;
export const METRIKA_SCRIPT = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`;

type Command = [number, string, ...unknown[]];
type Metrika = ((...args: Command) => void) & { a?: Command[]; l?: number };
declare global { interface Window { ym?: Metrika } }

let initialized = false;
let failed = false;
let previousUrl: string | undefined;
let tag: HTMLScriptElement | undefined;
let timeout: number | undefined;
let retry: number | undefined;

function loadTag(attempt = 0) {
  if (!LEGAL_READY || cookieChoice() !== "accepted") return;
  const script = document.createElement("script");
  tag = script;
  script.async = true;
  script.src = METRIKA_SCRIPT;
  timeout = window.setTimeout(unavailable, 15000);
  script.onload = () => window.clearTimeout(timeout);
  script.onerror = unavailable;
  function unavailable() {
    window.clearTimeout(timeout);
    script.onerror = null;
    script.onload = null;
    script.remove();
    if (cookieChoice() !== "accepted") return;
    if (attempt < 2) retry = window.setTimeout(() => loadTag(attempt + 1), 1000 * 2 ** attempt);
    else {
      failed = true;
      if (window.ym?.a) window.ym.a.length = 0;
      console.warn("Яндекс.Метрика недоступна: статистика этой вкладки отключена.");
    }
  }
  document.head.append(script);
}

function clearAnalyticsCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.trim().split("=", 1)[0];
    if (!/^_ym_/.test(name)) continue;
    const expired = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    document.cookie = expired;
    const labels = location.hostname.split(".");
    for (let index = 0; index < labels.length - 1; index++) {
      document.cookie = `${expired}; Domain=${labels.slice(index).join(".")}`;
    }
  }
}

export function stopMetrika() {
  window.clearTimeout(timeout);
  window.clearTimeout(retry);
  if (tag) { tag.onload = null; tag.onerror = null; tag.remove(); tag = undefined; }
  try {
    // The loaded SDK retains ym.a and dispatches commands through its push
    // method. Its presence does not mean that this is still an unloaded stub.
    if (initialized) window.ym?.(METRIKA_ID, "destruct");
  } catch { console.warn("Не удалось остановить Яндекс.Метрику."); }
  if (window.ym?.a) window.ym.a.length = 0;
  for (const script of document.querySelectorAll<HTMLScriptElement>("script[src]")) {
    // Metrica can load helper scripts such as tag_phono.js after tag.js.
    if (script.src.startsWith("https://mc.yandex.ru/metrika/")) script.remove();
  }
  try {
    clearAnalyticsCookies();
    for (const key of Object.keys(localStorage)) if (/^_ym/.test(key)) localStorage.removeItem(key);
  } catch { console.warn("Не удалось удалить локальные данные аналитики."); }
  initialized = false;
  previousUrl = undefined;
}

export function trackPage(url: string) {
  if (!LEGAL_READY || cookieChoice() !== "accepted") { stopMetrika(); return; }
  if (failed) return;
  const path = unlocalizedPath(new URL(url).pathname);
  if (/^\/(login|account|admin)(\/|$)/.test(path)) { stopMetrika(); return; }
  // Query strings can contain private route IDs and addresses.
  const safeUrl = new URL(new URL(url).pathname, location.origin).href;
  if (previousUrl === safeUrl) return;
  try {
    if (!initialized) {
      window.ym ??= Object.assign((...args: Command) => {
        (window.ym!.a ??= []).push(args);
      }, { l: Date.now() });
      window.ym(METRIKA_ID, "init", {
        defer: true, ssr: true, webvisor: false, clickmap: false,
        ecommerce: false, referrer: "", url: safeUrl, sendTitle: false,
        accurateTrackBounce: false, trackLinks: false, disableYtm: true,
      });
      initialized = true;
      loadTag();
    }
    window.ym?.(METRIKA_ID, "hit", safeUrl, { referer: previousUrl ?? "", title: "Отголосок" });
    previousUrl = safeUrl;
  } catch {
    failed = true;
    console.warn("Яндекс.Метрика недоступна: статистика этой вкладки отключена.");
  }
}
