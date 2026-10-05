/**
 * The Android app (mobile/, docs/agents/mobile-app.md) loads this same site and injects `window.Capacitor` before
 * any page script runs. Reading the global instead of importing @capacitor/core keeps the web bundle unchanged.
 *
 * The site updates instantly while people keep older app builds: every native feature checks its plugin with
 * hasNativePlugin() and falls back to the web implementation.
 */
export type NativePlatform = "ios" | "android";

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  isPluginAvailable?: (name: string) => boolean;
};

export type NativeScope = { Capacitor?: CapacitorGlobal };

function currentScope(): NativeScope | undefined {
  return typeof window === "undefined" ? undefined : (window as NativeScope);
}

/** null on the web (and during prerender). */
export function nativePlatform(scope: NativeScope | undefined = currentScope()): NativePlatform | null {
  const capacitor = scope?.Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  const platform = capacitor.getPlatform?.();
  return platform === "ios" || platform === "android" ? platform : null;
}

export function hasNativePlugin(name: string, scope: NativeScope | undefined = currentScope()): boolean {
  return nativePlatform(scope) !== null && scope?.Capacitor?.isPluginAvailable?.(name) === true;
}
