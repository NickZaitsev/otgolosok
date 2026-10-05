import { describe, expect, it } from "vitest";
import { APP_ID, buildCapacitorConfig } from "./capacitor-config";

describe("buildCapacitorConfig", () => {
  it("loads production by default and keeps the app on its own origin", () => {
    const config = buildCapacitorConfig({});

    expect(config.appId).toBe(APP_ID);
    expect(config.server?.url).toBe("https://otgolosok.online");
    // The error page and its retry link stay on the site's origin.
    expect(`${config.server?.androidScheme}://${config.server?.hostname}`).toBe(config.server?.url);
    expect(config.server?.cleartext).toBeUndefined();
    // Other hosts must open in the system browser, not inside the app.
    expect(config.server?.allowNavigation).toBeUndefined();
    // Native fetch/cookie patching would break same-origin auth and CSRF.
    expect(config.plugins?.CapacitorHttp).toBeUndefined();
    expect(config.plugins?.CapacitorCookies).toBeUndefined();
  });

  it.each([
    ["https://staging.otgolosok.online/some/path", {}, "https://staging.otgolosok.online"],
    ["http://192.168.1.5:3000", { OTGOLOSOK_APP_DEV: "1" }, "http://192.168.1.5:3000"],
  ])("accepts %s", (url, extra, expected) => {
    const config = buildCapacitorConfig({ OTGOLOSOK_APP_URL: url, ...extra });

    expect(config.server?.url).toBe(expected);
  });

  it("allows cleartext only in dev mode", () => {
    expect(buildCapacitorConfig({ OTGOLOSOK_APP_URL: "http://localhost:3000", OTGOLOSOK_APP_DEV: "1" }).server?.cleartext).toBe(
      true,
    );
  });

  it.each([
    ["http://otgolosok.online", {}],
    ["http://localhost:3000", { OTGOLOSOK_APP_DEV: "0" }],
    ["ftp://otgolosok.online", { OTGOLOSOK_APP_DEV: "1" }],
    ["not a url", {}],
  ])("rejects %s", (url, extra) => {
    expect(() => buildCapacitorConfig({ OTGOLOSOK_APP_URL: url, ...extra })).toThrow(/OTGOLOSOK_APP_URL/);
  });
});
