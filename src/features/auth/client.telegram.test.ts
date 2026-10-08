// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const ok = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("waits for a pending offline sign-out before starting Telegram OAuth", async () => {
  localStorage.setItem("otgolosok:auth:offline-logout", "old-marker");
  let finishRevoke!: (response: Response) => void;
  const revoke = new Promise<Response>(resolve => { finishRevoke = resolve; });
  const fetchMock = vi.fn()
    .mockReturnValueOnce(revoke)
    .mockResolvedValueOnce(ok({ url: "https://oauth.telegram.org/auth?bot_id=123" }));
  vi.stubGlobal("fetch", fetchMock);

  const { getTelegramAuthorizationUrl } = await import("./client");
  // Even if another local action clears the marker, the already-started revoke must finish first.
  localStorage.removeItem("otgolosok:auth:offline-logout");
  const authorization = getTelegramAuthorizationUrl("/walk?id=42", "en", "https://otgolosok.online");
  await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/sign-out");

  finishRevoke(ok({}));
  await expect(authorization).resolves.toBe("https://oauth.telegram.org/auth?bot_id=123");
  expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/sign-in/social");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    provider: "telegram",
    callbackURL: "/en/walk?id=42",
    errorCallbackURL: "/en/login?telegram_error=1&returnTo=%2Fen%2Fwalk%3Fid%3D42",
    disableRedirect: true,
  });
  expect(localStorage.getItem("otgolosok:auth:offline-logout")).toBeNull();
});

it("does not erase a newer offline sign-out marker while an earlier revoke is in flight", async () => {
  localStorage.setItem("otgolosok:auth:offline-logout", "first");
  let finishFirst!: (response: Response) => void;
  const first = new Promise<Response>(resolve => { finishFirst = resolve; });
  const fetchMock = vi.fn()
    .mockReturnValueOnce(first)
    .mockResolvedValueOnce(ok({}))
    .mockResolvedValueOnce(ok({ url: "https://oauth.telegram.org/auth" }));
  vi.stubGlobal("fetch", fetchMock);

  const { getTelegramAuthorizationUrl } = await import("./client");
  const authorization = getTelegramAuthorizationUrl("/account", "ru", "https://otgolosok.online");
  localStorage.setItem("otgolosok:auth:offline-logout", "second");
  finishFirst(ok({}));
  await expect(authorization).resolves.toBe("https://oauth.telegram.org/auth");
  expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
    "/api/auth/sign-out",
    "/api/auth/sign-out",
    "/api/auth/sign-in/social",
  ]);
  expect(localStorage.getItem("otgolosok:auth:offline-logout")).toBeNull();
});

it.each([
  "http://oauth.telegram.org/auth",
  "https://oauth.telegram.org.evil.test/auth",
  "https://oauth.telegram.org/not-auth",
])("rejects an untrusted Telegram authorization URL: %s", async url => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ url })));
  const { getTelegramAuthorizationUrl } = await import("./client");
  await expect(getTelegramAuthorizationUrl("/account", "ru", "https://otgolosok.online")).rejects.toThrow("неожиданный адрес Telegram");
});
