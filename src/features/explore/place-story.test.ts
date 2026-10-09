// @vitest-environment jsdom

import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";

const revalidate = vi.fn(async () => {});
vi.mock("./map-cells", () => ({ mapCellStore: { revalidate } }));

type Module = typeof import("./place-story");
let placeStory: Module;
let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<Module["usePlaceStory"]>;

const detail = (id: string, overrides: Record<string, unknown> = {}) => Response.json({ place: { id, text: {
  story: { title: "История", paragraphs: [{ text: "Первый абзац." }, { text: " " }, { text: "Второй абзац." }],
    sources: [{ publisher: "data.mos.ru", url: "https://data.mos.ru/opendata/1" }] },
  audio: { url: "/api/story-audio/a.mp3", durationSec: 61 }, ...overrides,
} } });

function Probe({ id, locale = "ru" }: { id?: string; locale?: Locale }) {
  latest = placeStory.usePlaceStory(id, locale);
  return null;
}
const show = (id?: string, locale: Locale = "ru") => act(async () => root.render(createElement(Probe, { id, locale })));

beforeEach(async () => {
  vi.resetModules();
  revalidate.mockClear();
  placeStory = await import("./place-story");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("maps the published text, attribution and audio, and serves a reopened story from memory", async () => {
  const fetcher = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async path => detail(path.split("/").at(-1)!));
  vi.stubGlobal("fetch", fetcher);
  await show("osm:node:1");
  expect(latest.status).toBe("ready");
  expect(latest.story).toEqual({
    paragraphs: ["Первый абзац.", "Второй абзац."],
    attribution: { url: "https://data.mos.ru/opendata/1", label: "Портал открытых данных Правительства Москвы" },
    audioUrl: "/api/story-audio/a.mp3", durationSec: 61, actualLocale: "ru",
  });
  expect(fetcher.mock.calls[0][0]).toBe("/api/content/places/osm:node:1");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-cache" });
  await show(undefined);
  expect(latest.status).toBe("idle");
  await show("osm:node:1");
  expect(latest.status).toBe("ready");
  expect(fetcher).toHaveBeenCalledOnce();
});

it("keeps a story without audio free of a player", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => detail("osm:node:2", { audio: null })));
  await show("osm:node:2");
  expect(latest.story).toEqual({ paragraphs: ["Первый абзац.", "Второй абзац."], attribution: expect.anything(), actualLocale: "ru" });
});

it("requests and caches each localized story separately", async () => {
  const localized = (locale: "en" | "zh", title: string, paragraph: string) => Response.json({ place: {
    id: "osm:node:20", name: "Дом", address: "Москва", location: { lat: 55.75, lon: 37.61 },
    text: {
      story: { title, paragraphs: [{ text: paragraph }], sources: [] },
      audio: { url: `/api/story-audio/${locale}.mp3`, durationSec: 42, language: locale },
      localization: { requestedLocale: locale, contentLocale: locale, fallbackReason: null },
    },
  } });
  const fetcher = vi.fn(async (path: string) => path.endsWith("lang=en")
    ? localized("en", "A house in Moscow", "English text.")
    : localized("zh", "莫斯科的一座房子", "中文文本。"));
  vi.stubGlobal("fetch", fetcher);

  await show("osm:node:20", "en");
  expect(latest.story).toMatchObject({ actualLocale: "en", paragraphs: ["English text."], place: { title: "A house in Moscow" } });
  await show("osm:node:20", "zh");
  expect(latest.story).toMatchObject({ actualLocale: "zh", paragraphs: ["中文文本。"], place: { title: "莫斯科的一座房子" } });
  await show("osm:node:20", "en");

  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
    "/api/content/places/osm:node:20?lang=en",
    "/api/content/places/osm:node:20?lang=zh",
  ]);
  expect(latest.story?.actualLocale).toBe("en");
});

it.each([
  { case: "the response belongs to another request", localization: { requestedLocale: "zh", contentLocale: "zh", fallbackReason: null }, audioLanguage: "zh" },
  { case: "a fallback does not identify Russian content", localization: { requestedLocale: "en", contentLocale: "zh", fallbackReason: "missing" }, audioLanguage: "zh" },
  { case: "a fallback has no reason", localization: { requestedLocale: "en", contentLocale: "ru", fallbackReason: null }, audioLanguage: "ru" },
  { case: "matching content has a fallback reason", localization: { requestedLocale: "en", contentLocale: "en", fallbackReason: "stale" }, audioLanguage: "en" },
  { case: "the audio language differs from the text", localization: { requestedLocale: "en", contentLocale: "en", fallbackReason: null }, audioLanguage: "ru" },
])("rejects invalid localization metadata when $case", ({ localization, audioLanguage }) => {
  expect(() => placeStory.parsePlaceStory({ place: { text: {
    story: { paragraphs: [{ text: "Text." }] },
    audio: { url: "/api/story-audio/a.mp3", durationSec: 10, language: audioLanguage },
    localization,
  } } }, "en")).toThrow("Некорректный ответ рассказа.");
});

it("accepts Russian legacy data but requires an explicit language for translated audio", () => {
  expect(placeStory.parsePlaceStory({ place: { text: {
    story: { paragraphs: [{ text: "Русский текст." }] }, audio: { url: "/api/story-audio/ru.mp3", durationSec: 10 },
  } } }, "en").actualLocale).toBe("ru");
  expect(() => placeStory.parsePlaceStory({ place: { text: {
    story: { paragraphs: [{ text: "English text." }] }, audio: { url: "/api/story-audio/en.mp3", durationSec: 10 },
    localization: { requestedLocale: "en", contentLocale: "en", fallbackReason: null },
  } } }, "en")).toThrow("Некорректный ответ рассказа.");
});

it("reports an unpublished story as missing and refreshes the map index", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 })));
  await show("osm:node:3");
  expect(latest.status).toBe("missing");
  expect(revalidate).toHaveBeenCalledOnce();
});

it("shows an error after a malformed response and succeeds on retry", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ place: { text: null } }))
    .mockResolvedValueOnce(detail("osm:node:4"));
  vi.stubGlobal("fetch", fetcher);
  await show("osm:node:4");
  expect(latest.status).toBe("error");
  await act(async () => latest.retry());
  expect(latest.status).toBe("ready");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("aborts the previous request when another story opens", async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => {
    signals.push(init.signal!);
    return path.endsWith("5") ? new Promise<Response>(() => {}) : Promise.resolve(detail("osm:node:6"));
  }));
  await show("osm:node:5");
  expect(latest.status).toBe("loading");
  await show("osm:node:6");
  expect(signals[0].aborted).toBe(true);
  expect(latest.status).toBe("ready");
});

it("shares one request between the StrictMode remount and a second sheet of the same place", async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => { signals.push(init.signal!); return detail(path.split("/").at(-1)!); }));
  await act(async () => root.render(createElement(StrictMode, null, createElement(Probe, { id: "osm:node:7" }), createElement(Probe, { id: "osm:node:7" }))));
  expect(latest.status).toBe("ready");
  expect(signals).toHaveLength(1);
  expect(signals[0].aborted).toBe(false);
});

const photo = {
  thumbnail: `/api/place-images/${"1".repeat(64)}.jpg`, src: `/api/place-images/${"2".repeat(64)}.jpg`, width: 960, height: 720,
  alt: "Дом Пашкова", author: "NVO", sourceUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
  license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
};
const storyWith = (value: unknown) => placeStory.parsePlaceStory({ place: { text: { story: { paragraphs: [{ text: "Абзац." }] } }, ...(value === undefined ? {} : { photo: value }) } });

it("reads the place photo, including an editorial copy and a photo without an author", () => {
  expect(storyWith(photo).photo).toEqual(photo);
  const editorial = { ...photo, thumbnail: "/images/places/way-1-7bb38a14d975.jpg", src: "/images/places/way-1-46765eae7280.jpg" };
  expect(storyWith(editorial).photo).toEqual(editorial);
  expect(storyWith({ ...photo, author: null }).photo).toEqual({ ...photo, author: null });
  expect(storyWith(undefined)).toEqual({ paragraphs: ["Абзац."], actualLocale: "ru" });
  expect(storyWith(null)).toEqual({ paragraphs: ["Абзац."], actualLocale: "ru" });
});

it("reads a linked Flickr embed only when the source identifies the same photo", () => {
  const flickr = { ...photo,
    thumbnail: "https://live.staticflickr.com/65535/49953438251_37d4c7ba6f_q.jpg",
    src: "https://live.staticflickr.com/65535/49953438251_37d4c7ba6f_b.jpg",
    sourceUrl: "https://www.flickr.com/photos/absolutenull/49953438251/" };
  expect(storyWith(flickr).photo).toEqual(flickr);
  expect(storyWith({ ...flickr, sourceUrl: "https://www.flickr.com/photos/absolutenull/49953438252/" }).photo).toBeUndefined();
  expect(storyWith({ ...flickr, src: flickr.src.replace("_b.jpg", "_q.jpg") }).photo).toBeUndefined();
});

it.each([
  ["a foreign host", { thumbnail: "https://upload.wikimedia.org/a.jpg" }],
  ["a path traversal", { src: `/api/place-images/../${"2".repeat(64)}.jpg` }],
  ["a short hash", { src: "/api/place-images/abc.jpg" }],
  ["a zero width", { width: 0 }],
  ["a fractional height", { height: 1.5 }],
  ["an empty license", { license: " " }],
  ["an empty alt", { alt: "" }],
  ["a script source link", { sourceUrl: "javascript:alert(1)" }],
  ["a relative license link", { licenseUrl: "/license" }],
  ["a numeric author", { author: 7 }],
])("drops a photo with %s and keeps the story", (_, broken) => {
  expect(storyWith({ ...photo, ...broken })).toEqual({ paragraphs: ["Абзац."], actualLocale: "ru" });
});

const withHeader = (place: Record<string, unknown>, title?: string) =>
  placeStory.parsePlaceStory({ place: { ...place, text: { story: { ...(title === undefined ? {} : { title }), paragraphs: [{ text: "Абзац." }] } } } });

it.each([
  { case: "the story title wins over the place name", place: { name: "Дом", address: "ул. Арбат, 1", location: { lat: 55.75, lon: 37.59 } }, title: "Дом Мельникова",
    expected: { title: "Дом Мельникова", address: "ул. Арбат, 1", location: { lat: 55.75, lon: 37.59 } } },
  { case: "without a title and an address the name stands for both", place: { name: "Памятник", address: null, location: { lat: 55.7, lon: 37.6 } }, title: " ",
    expected: { title: "Памятник", address: "Памятник", location: { lat: 55.7, lon: 37.6 } } },
  { case: "no location", place: { name: "Дом" }, title: "Дом", expected: undefined },
  { case: "a latitude out of range", place: { name: "Дом", location: { lat: 95, lon: 37.6 } }, title: "Дом", expected: undefined },
  { case: "a text coordinate", place: { name: "Дом", location: { lat: "55.7", lon: 37.6 } }, title: "Дом", expected: undefined },
  { case: "no name", place: { location: { lat: 55.7, lon: 37.6 } }, title: "Дом", expected: undefined },
])("reads the place header for a linked place: $case", ({ place, title, expected }) => {
  const story = withHeader(place, title);
  expect(story.place).toEqual(expected);
  expect(story.paragraphs).toEqual(["Абзац."]);
});
