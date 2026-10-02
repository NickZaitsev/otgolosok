export const METRIKA_ID = 113326536;
export const METRIKA_SCRIPT = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`;

type Command = [number, string, ...unknown[]];
type Metrika = ((...args: Command) => void) & { a?: Command[]; l?: number };

declare global {
  interface Window { ym?: Metrika }
}

let initialized = false;
let failed = false;
let previousUrl: string | undefined;

function loadTag(attempt = 0) {
  const script = document.createElement("script");
  script.async = true;
  script.src = METRIKA_SCRIPT;
  const timeout = window.setTimeout(() => unavailable(), 15000);
  script.onload = () => window.clearTimeout(timeout);
  script.onerror = unavailable;
  function unavailable() {
    window.clearTimeout(timeout);
    script.onerror = null;
    script.onload = null;
    script.remove();
    if (attempt < 2) {
      window.setTimeout(() => loadTag(attempt + 1), 1000 * 2 ** attempt);
    } else {
      failed = true;
      // Stop retaining page views when a blocker or network prevents loading.
      if (window.ym?.a) window.ym.a.length = 0;
      console.warn("Яндекс.Метрика недоступна: статистика этой вкладки отключена.");
    }
  }
  document.head.append(script);
}

export function trackPage(url: string) {
  if (failed || previousUrl === url) return;
  try {
    if (!initialized) {
      window.ym ??= Object.assign((...args: Command) => {
        (window.ym!.a ??= []).push(args);
      }, { l: Date.now() });
      window.ym(METRIKA_ID, "init", {
        defer: true, ssr: true, webvisor: true, clickmap: true,
        ecommerce: "dataLayer", referrer: document.referrer, url,
        accurateTrackBounce: true, trackLinks: true,
      });
      initialized = true;
      loadTag();
    }
    window.ym?.(METRIKA_ID, "hit", url, {
      referer: previousUrl ?? document.referrer,
      title: document.title,
    });
    previousUrl = url;
  } catch {
    failed = true;
    console.warn("Яндекс.Метрика недоступна: статистика этой вкладки отключена.");
  }
}
