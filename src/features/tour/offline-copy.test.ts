// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { OfflineCopyControls, type OfflineCopy } from "./offline-copy";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

async function render(locale: Locale, saved: number | null) {
  const copy: OfflineCopy = { saved, message: "", busy: false, save: async () => {}, remove: async () => {} };
  await act(async () => {
    root.render(createElement(I18nProvider, { locale } as ComponentProps<typeof I18nProvider>, createElement(OfflineCopyControls, { copy, statusClassName: "status" })));
  });
}

it.each([
  ["en", 1, "Offline copy saved · 1 recording", "Update offline copy"],
  ["en", 3, "Offline copy saved · 3 recordings", "Update offline copy"],
  ["zh", 3, "离线副本已保存 · 3 个音频", "更新离线副本"],
] as const)("показывает состояние офлайн-копии для %s", async (locale, saved, status, action) => {
  await render(locale, saved);
  expect(container.querySelector("[role=status]")?.textContent).toBe(status);
  expect(container.querySelector("button")?.textContent).toBe(action);
});

it("объясняет по-китайски, что копия ещё не сохранена", async () => {
  await render("zh", null);
  expect(container.textContent).toContain("尚未保存离线副本");
  expect(container.textContent).toContain("保存漫步以便离线使用");
});
