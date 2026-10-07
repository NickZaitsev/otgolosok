// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { Account } from "./account";
import { accountApi, getSession } from "../auth/client";
import { savedStories } from "../generator/offline";

vi.mock("../navigation/app-header", () => ({ AppHeader: () => null }));
vi.mock("../auth/client", () => ({
  getSession: vi.fn(),
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
  vi.mocked(getSession).mockResolvedValue({ id: "user-1", name: "Anna", email: "anna@example.test" });
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
  ["en", "My walks", "Account settings", "/en/history"],
  ["zh", "我的漫步", "账户设置", "/zh/history"],
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
