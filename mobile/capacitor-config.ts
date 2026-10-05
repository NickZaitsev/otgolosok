import type { CapacitorConfig } from "@capacitor/cli";

export const APP_ID = "online.otgolosok.app";
export const DEFAULT_APP_URL = "https://otgolosok.online";

/** Brand background from src/app/manifest.ts — shown before the remote page paints. */
const BACKGROUND_COLOR = "#eee9df";

/**
 * Next.js 16 supports Chrome 111+ (node_modules/next/dist/docs/03-architecture/supported-browsers.md).
 * It is also far above the WebView version that supports document-start scripts, so Capacitor
 * injects its bridge without rewriting our HTML, and our CSP (no 'unsafe-inline') stays intact.
 * Older WebViews get the bundled error page instead of a broken site.
 */
const MIN_WEBVIEW_VERSION = 111;

/**
 * Environment read by the config (process.env in capacitor.config.ts):
 * - OTGOLOSOK_APP_URL — site the shell loads; production by default;
 * - OTGOLOSOK_APP_DEV — "1" allows a plain-http URL (a LAN `pnpm dev`); never set for store builds.
 */
export type CapacitorConfigEnv = Readonly<Record<string, string | undefined>>;

/**
 * Remote shell config: the app loads the real site so cookies, CSRF, relative /api calls,
 * the Service Worker and share links keep working (docs/agents/mobile-app.md).
 */
export function buildCapacitorConfig(env: CapacitorConfigEnv): CapacitorConfig {
  const dev = env.OTGOLOSOK_APP_DEV === "1";
  const url = new URL(parseAppUrl(env.OTGOLOSOK_APP_URL || DEFAULT_APP_URL, dev));

  return {
    appId: APP_ID,
    appName: "Отголосок",
    webDir: "mobile/www",
    backgroundColor: BACKGROUND_COLOR,
    server: {
      url: url.origin,
      // The bundled error page is served at <androidScheme>://<hostname>/app-error.html. With the default
      // `localhost` its «Повторить» (`/`) would leave the site's host, and Capacitor hands such links to the browser.
      hostname: url.hostname,
      androidScheme: url.protocol.slice(0, -1),
      errorPath: "app-error.html",
      ...(dev ? { cleartext: true } : {}),
    },
    android: {
      path: "mobile/android",
      minWebViewVersion: MIN_WEBVIEW_VERSION,
    },
    plugins: {
      SystemBars: {
        // WebView 140+ fills env(safe-area-inset-*) used by src/styles/tokens.css (viewport-fit=cover);
        // older WebViews get native padding instead, so the page never slides under the bars.
        insetsHandling: "native",
        initialViewportFitValueHint: "cover",
        // Dark icons for the light site even when the phone uses a dark theme; the walk screen switches it.
        style: "LIGHT",
      },
      SplashScreen: {
        // NativeShell hides it right after hydration; the timeout is a safety net for the error page.
        launchAutoHide: true,
        launchShowDuration: 3000,
        backgroundColor: BACKGROUND_COLOR,
        // Android < 12 shows @drawable/splash; crop keeps the logo round on any screen ratio.
        androidScaleType: "CENTER_CROP",
        showSpinner: false,
      },
    },
  };
}

function parseAppUrl(raw: string, dev: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`OTGOLOSOK_APP_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && !(dev && url.protocol === "http:")) {
    throw new Error(`OTGOLOSOK_APP_URL must use https (set OTGOLOSOK_APP_DEV=1 for a local http server): ${raw}`);
  }
  return url.origin;
}
