import type { WakeLockNavigatorLike, WakeLockSentinelLike } from "../wake-lock";
import { hasNativePlugin } from "./platform";

export type KeepAwakePlugin = {
  keepAwake(): Promise<void>;
  allowSleep(): Promise<void>;
};

async function loadKeepAwake(): Promise<KeepAwakePlugin> {
  return (await import("@capacitor-community/keep-awake")).KeepAwake;
}

class KeepAwakeSentinel extends EventTarget implements WakeLockSentinelLike {
  released = false;
  readonly #plugin: KeepAwakePlugin;

  constructor(plugin: KeepAwakePlugin) {
    super();
    this.#plugin = plugin;
  }

  async release() {
    if (this.released) return;
    this.released = true;
    try {
      await this.#plugin.allowSleep();
    } finally {
      this.dispatchEvent(new Event("release"));
    }
  }
}

/** A Screen Wake Lock lookalike on top of the KeepAwake plugin, for createWakeLockController. */
export function keepAwakeNavigator(load: () => Promise<KeepAwakePlugin> = loadKeepAwake): WakeLockNavigatorLike {
  return {
    wakeLock: {
      async request() {
        const plugin = await load();
        await plugin.keepAwake();
        return new KeepAwakeSentinel(plugin);
      },
    },
  };
}

/**
 * Android WebView has no Screen Wake Lock API, so in the app the walk keeps the screen on through the native plugin.
 * undefined on the web (and in an app build without the plugin): the controller then uses `navigator`.
 */
export function appWakeLockNavigator(): WakeLockNavigatorLike | undefined {
  return hasNativePlugin("KeepAwake") ? keepAwakeNavigator() : undefined;
}
