// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContentLanguageNote } from "./content-language-note";
import { I18nProvider } from "./provider";
import type { Locale } from "./locale";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

async function render(locale: Locale, props: ComponentProps<typeof ContentLanguageNote> = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(createElement(I18nProvider, { locale }, createElement(ContentLanguageNote, props))));
  return { container, unmount: () => act(async () => root.unmount()) };
}

it.each(["en", "zh"] as const)("explains a Russian text and recording in the %s interface", async locale => {
  const { container, unmount } = await render(locale, { contentLocale: "ru", audioAvailable: true });
  expect(container.querySelector("[role='note']")?.textContent).toBe(locale === "en"
    ? "This story's text and audio are currently available in Russian only."
    : "本故事的文字和音频目前仅提供俄语版本。");
  await unmount();
});

it("distinguishes a Russian fallback without audio", async () => {
  const { container, unmount } = await render("en", { contentLocale: "ru", audioAvailable: false });
  expect(container.textContent).toBe("This story's text is currently available in Russian only. Narration is being prepared.");
  await unmount();
});

it.each(["en", "zh"] as const)("explains missing narration for translated %s content", async locale => {
  const { container, unmount } = await render(locale, { contentLocale: locale, audioAvailable: false });
  expect(container.textContent).toBe(locale === "en"
    ? "Narration in your selected language is being prepared."
    : "所选语言的音频正在制作中。");
  await unmount();
});

it("renders nothing for Russian UI or a complete localized story", async () => {
  const russian = await render("ru", { contentLocale: "ru", audioAvailable: false });
  expect(russian.container.innerHTML).toBe("");
  await russian.unmount();
  const localized = await render("en", { contentLocale: "en", audioAvailable: true });
  expect(localized.container.innerHTML).toBe("");
  await localized.unmount();
});

it("keeps the legacy no-props behavior", async () => {
  const { container, unmount } = await render("en");
  expect(container.textContent).toContain("text and audio");
  await unmount();
});
