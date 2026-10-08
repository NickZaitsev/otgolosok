// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { Account } from "./account";
import { accountApi, getSession, getTelegramAuthorizationUrl } from "../auth/client";
import { savedStories } from "../generator/offline";

vi.mock("../navigation/app-header", () => ({ AppHeader: () => null }));
vi.mock("../auth/client", () => ({
  getSession: vi.fn(),
  getTelegramAuthorizationUrl: vi.fn(),
  accountApi: vi.fn(),
  signOut: vi.fn(),
  signOutEverywhere: vi.fn(),
}));
vi.mock("../generator/offline", () => ({ savedStories: vi.fn() }));
vi.mock("../walks/offline", () => ({ clearOfflineScope: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../explore/icons", () => ({ ExploreIcon: () => null }));

let root: Root;
let container: HTMLDivElement;

async function mount(locale: Locale) {
  await act(async () => root.render(createElement(I18nProvider, { locale } as ComponentProps<typeof I18nProvider>, createElement(Account))));
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("location", { origin: "https://otgolosok.online", search: "", replace: vi.fn() });
  sessionStorage.clear();
  vi.mocked(getSession).mockResolvedValue({ id: "user-1", name: "Anna", email: "anna@example.test" });
  vi.mocked(getTelegramAuthorizationUrl).mockResolvedValue("https://oauth.telegram.org/auth?bot_id=1");
  vi.mocked(accountApi).mockImplementation(async path => path.endsWith("/requests")
    ? { requests: [], nextCursor: null }
    : { favorites: [], nextCursor: null });
  vi.mocked(savedStories).mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ["en", "My walks", "Account settings", "/en/account/walks"],
  ["zh", "我的漫步", "账户设置", "/zh/account/walks"],
] as const)("renders account navigation and settings in %s", async (locale, walks, settings, href) => {
  await mount(locale);
  const history = [...container.querySelectorAll("a")].find(link => link.textContent?.includes(walks));
  expect(history?.getAttribute("href")).toBe(href);
  expect(container.textContent).toContain(settings);
  expect(container.textContent).toContain(locale === "en" ? "Your favorite stories and walks will appear here." : "您收藏的故事和漫步路线会显示在这里。");
});

it.each([
  ["en", "Unable to reach the server. Check your connection and try again.", "Try loading again"],
  ["zh", "无法连接服务器。请检查网络后重试。", "重新加载"],
] as const)("shows a localized account section failure in %s", async (locale, message, retry) => {
  vi.mocked(accountApi).mockImplementation(async path => {
    if (path.endsWith("/requests")) throw new TypeError("Failed to fetch");
    return { favorites: [], nextCursor: null };
  });
  await mount(locale);
  const alert = container.querySelector("[role=alert]");
  expect(alert?.textContent).toContain(message);
  expect(alert?.querySelector("button")?.textContent).toBe(retry);
  expect(container.textContent).toContain("Anna");
});

it("shows Telegram identity and deletes a freshly authenticated Telegram account only after confirmation", async () => {
  vi.mocked(getSession).mockResolvedValue({ id: "user-1", name: "Anna", email: null, authMethod: "telegram", requiresReauthentication: false });
  await mount("ru");
  expect(container.querySelector(".profile-identity")?.textContent).toContain("Telegram");
  const deleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Удалить аккаунт")!;
  await act(async () => deleteButton.click());
  expect(container.querySelector('.profile-confirm input[type="password"]')).toBeNull();
  expect(vi.mocked(accountApi).mock.calls.some(([path]) => path === "/api/me")).toBe(false);
  await act(async () => container.querySelector<HTMLFormElement>(".profile-confirm")!.requestSubmit());
  expect(accountApi).toHaveBeenCalledWith("/api/me", { method: "DELETE", body: "{}" });
});

it("requires Telegram reauthentication before offering deletion", async () => {
  vi.mocked(getSession).mockResolvedValue({ id: "user-1", name: "Anna", email: null, authMethod: "telegram", requiresReauthentication: true });
  await mount("ru");
  const deleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Удалить аккаунт")!;
  await act(async () => deleteButton.click());
  const confirmTelegram = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Подтвердить в Telegram")!;
  expect(confirmTelegram.type).toBe("button");
  await act(async () => confirmTelegram.click());
  expect(getTelegramAuthorizationUrl).toHaveBeenCalledWith("/account?telegramDelete=1", "ru", "https://otgolosok.online");
  expect(sessionStorage.getItem("otgolosok:account:telegram-delete-user")).toBe("user-1");
  expect(accountApi).not.toHaveBeenCalledWith("/api/me", expect.objectContaining({ method: "DELETE" }));
  expect(location.replace).toHaveBeenCalledWith("https://oauth.telegram.org/auth?bot_id=1");
});

it("switches an expired fresh Telegram deletion to reauthentication and guards form submit", async () => {
  vi.mocked(getSession).mockResolvedValue({ id: "user-1", name: "Anna", email: null, authMethod: "telegram", requiresReauthentication: false });
  vi.mocked(accountApi).mockImplementation(async (path, init) => {
    if (path === "/api/me" && init?.method === "DELETE") throw Object.assign(new Error("Повторите вход через Telegram перед удалением аккаунта."), { code: "REAUTH_REQUIRED" });
    return path.endsWith("/requests") ? { requests: [], nextCursor: null } : { favorites: [], nextCursor: null };
  });
  await mount("ru");
  const deleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Удалить аккаунт")!;
  await act(async () => deleteButton.click());
  const form = container.querySelector<HTMLFormElement>(".profile-confirm")!;
  await act(async () => form.requestSubmit());
  expect(container.querySelector("[role=status]")?.textContent).toContain("Срок подтверждения Telegram истёк");
  expect([...form.querySelectorAll("button")].some(button => button.textContent === "Подтвердить в Telegram")).toBe(true);
  expect(vi.mocked(accountApi).mock.calls.filter(([path, init]) => path === "/api/me" && init?.method === "DELETE")).toHaveLength(1);

  await act(async () => form.requestSubmit());
  expect(getTelegramAuthorizationUrl).toHaveBeenCalledWith("/account?telegramDelete=1", "ru", "https://otgolosok.online");
  expect(vi.mocked(accountApi).mock.calls.filter(([path, init]) => path === "/api/me" && init?.method === "DELETE")).toHaveLength(1);
});

it("returns a matching Telegram user to confirmation without deleting automatically", async () => {
  vi.stubGlobal("location", { origin: "https://otgolosok.online", search: "?telegramDelete=1", replace: vi.fn() });
  sessionStorage.setItem("otgolosok:account:telegram-delete-user", "user-1");
  vi.mocked(getSession).mockResolvedValue({ id: "user-1", name: "Anna", email: null, authMethod: "telegram", requiresReauthentication: false });
  await mount("ru");
  expect(container.querySelector(".profile-confirm h3")?.textContent).toBe("Удалить аккаунт навсегда?");
  expect(accountApi).not.toHaveBeenCalledWith("/api/me", expect.objectContaining({ method: "DELETE" }));
  expect(sessionStorage.getItem("otgolosok:account:telegram-delete-user")).toBeNull();
});

it("cancels deletion when Telegram reauthentication returns a different user", async () => {
  vi.stubGlobal("location", { origin: "https://otgolosok.online", search: "?telegramDelete=1", replace: vi.fn() });
  sessionStorage.setItem("otgolosok:account:telegram-delete-user", "user-1");
  vi.mocked(getSession).mockResolvedValue({ id: "user-2", name: "Boris", email: null, authMethod: "telegram", requiresReauthentication: false });
  await mount("ru");
  expect(container.querySelector("[role=status]")?.textContent).toContain("Удаление отменено");
  expect(container.querySelector(".profile-confirm")).toBeNull();
  expect(accountApi).not.toHaveBeenCalledWith("/api/me", expect.objectContaining({ method: "DELETE" }));
  expect(sessionStorage.getItem("otgolosok:account:telegram-delete-user")).toBeNull();
});

it("keeps password deletion unchanged for email accounts", async () => {
  await mount("ru");
  const deleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Удалить аккаунт")!;
  await act(async () => deleteButton.click());
  const password = container.querySelector<HTMLInputElement>('.profile-confirm input[type="password"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(password, "correct-length");
  await act(async () => password.dispatchEvent(new Event("input", { bubbles: true })));
  await act(async () => container.querySelector<HTMLFormElement>(".profile-confirm")!.requestSubmit());
  expect(accountApi).toHaveBeenCalledWith("/api/me", { method: "DELETE", body: JSON.stringify({ password: "correct-length" }) });
});
