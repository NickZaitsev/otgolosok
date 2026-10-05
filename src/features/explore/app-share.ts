import { hasNativePlugin } from "@/lib/native/platform";
import { browserShareEnvironment, type ShareEnvironment } from "./share-place";

export type SharePlugin = {
  share(options: { title?: string; text?: string; url?: string; dialogTitle?: string }): Promise<unknown>;
};

async function loadShare(): Promise<SharePlugin> {
  return (await import("@capacitor/share")).Share;
}

/** The plugin rejects a closed share sheet with this message on Android and iOS. */
const CANCELLED = /cancel/i;

/** The system share sheet through the native plugin: Android WebView has no Web Share API. */
export function nativeShareEnvironment(load: () => Promise<SharePlugin> = loadShare, browser = browserShareEnvironment()): ShareEnvironment {
  return {
    async share({ title, text, url }) {
      try {
        await (await load()).share({ title, text, url, dialogTitle: "Поделиться" });
      } catch (error) {
        if (error instanceof Error && CANCELLED.test(error.message)) throw new DOMException(error.message, "AbortError");
        throw error;
      }
    },
    writeText: browser.writeText,
  };
}

/** The native share sheet in the app, the browser's elsewhere (and in an app build without the plugin). */
export function appShareEnvironment(): ShareEnvironment {
  return hasNativePlugin("Share") ? nativeShareEnvironment() : browserShareEnvironment();
}
