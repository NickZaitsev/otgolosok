import { hasNativePlugin } from "@/lib/native/platform";
import { isPlaceId, placeMapUrl } from "../explore/place-link";

const PLACE_SHARE_PATH = /^\/place\/(node|way|relation)\/([1-9]\d{0,18})$/;

/**
 * The in-app path for a site link that opened the app (Android App Links, mobile/android AndroidManifest.xml),
 * or null for anything the app must not open: other hosts, the API, the admin, unknown pages.
 * The share page `/place/<type>/<number>` goes straight to the map, skipping its Open Graph redirect.
 */
export function inAppPathFromUrl(url: string, appOrigin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== appOrigin) return null;

  const share = PLACE_SHARE_PATH.exec(parsed.pathname);
  if (share) {
    const id = `osm:${share[1]}:${share[2]}`;
    return isPlaceId(id) ? placeMapUrl(id) : null;
  }
  if (parsed.pathname === "/" || parsed.pathname === "/walk") return `${parsed.pathname}${parsed.search}`;
  return null;
}

export type AppLinkOptions = {
  /** Asked before a link replaces the current page; false keeps the user where they are. */
  confirmLeave: () => boolean;
};

/**
 * Opens an in-app path. A place on the map page changes only the URL: Next follows pushState without a reload
 * (src/features/explore/use-place-url.ts), so the map and a running walk stay. Anything else is a navigation.
 */
export function openInAppPath(path: string, options: AppLinkOptions, page: Pick<Location, "pathname" | "search" | "assign"> = location): void {
  if (path === `${page.pathname}${page.search}`) return;
  const target = new URL(path, "https://app.invalid");
  if (target.pathname === "/" && page.pathname === "/" && target.searchParams.has("place")) {
    history.pushState({}, "", path);
    return;
  }
  if (options.confirmLeave()) page.assign(path);
}

const HANDLED_LAUNCH_KEY = "otgolosok:handled-launch-url";

/**
 * Follows links that open the app: the one it was launched with (once per app run: the page reloads, the launch
 * URL stays) and the ones that arrive while it runs. Returns a stop function; does nothing on the web.
 */
export function listenForAppLinks(options: AppLinkOptions): () => void {
  if (!hasNativePlugin("App")) return () => {};
  let stopped = false;
  let removeListener: (() => Promise<void>) | null = null;
  const open = (url: string | undefined) => {
    if (stopped || !url) return;
    const path = inAppPathFromUrl(url, location.origin);
    if (path) openInAppPath(path, options);
  };

  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appUrlOpen", (event) => open(event.url));
      if (stopped) {
        await handle.remove();
        return;
      }
      removeListener = () => handle.remove();
      const launch = await App.getLaunchUrl();
      if (launch?.url && readHandledLaunch() !== launch.url) {
        writeHandledLaunch(launch.url);
        open(launch.url);
      }
    } catch (error) {
      // Without the plugin a link still opens the app on its start page.
      console.warn("Не удалось подключить ссылки приложения.", error);
    }
  })();

  return () => {
    stopped = true;
    void removeListener?.();
  };
}

function readHandledLaunch(): string | null {
  try {
    return sessionStorage.getItem(HANDLED_LAUNCH_KEY);
  } catch {
    return null;
  }
}

function writeHandledLaunch(url: string): void {
  try {
    sessionStorage.setItem(HANDLED_LAUNCH_KEY, url);
  } catch {
    // Storage is off: the worst case is reopening the launch link after a reload.
  }
}
