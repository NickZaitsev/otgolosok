import { describe, expect, it } from "vitest";
import { hasNativePlugin, nativePlatform, type NativeScope } from "./platform";

function app(platform: string, plugins: string[] = [], native = true): NativeScope {
  return {
    Capacitor: {
      isNativePlatform: () => native,
      getPlatform: () => platform,
      isPluginAvailable: (name) => plugins.includes(name),
    },
  };
}

describe("nativePlatform", () => {
  it.each([
    ["no scope (prerender)", undefined, null],
    ["a browser without the bridge", {}, null],
    ["Capacitor's web runtime", app("web", [], false), null],
    ["the Android app", app("android"), "android"],
    ["the iOS app", app("ios"), "ios"],
    ["an unknown platform", app("electron"), null],
  ] as const)("%s", (_, scope, expected) => {
    expect(nativePlatform(scope)).toBe(expected);
  });
});

describe("hasNativePlugin", () => {
  it("is true only for a plugin the installed app build ships", () => {
    const scope = app("android", ["KeepAwake"]);

    expect(hasNativePlugin("KeepAwake", scope)).toBe(true);
    // An older build without the plugin: the feature must fall back to the web.
    expect(hasNativePlugin("Share", scope)).toBe(false);
  });

  it("is false on the web even if a page script defines a lookalike", () => {
    expect(hasNativePlugin("KeepAwake", app("web", ["KeepAwake"], false))).toBe(false);
  });
});
