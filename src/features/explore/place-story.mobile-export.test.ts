import { describe, expect, it } from "vitest";
import { mobileFlutterPath, mutate, stableJson, verdict, type Mutation } from "@/lib/mobile-export/snapshot";
import type { Locale } from "@/lib/i18n/locale";
import { parsePlacePhoto, parsePlaceStory } from "./place-story";

// The Dart port (mobile-flutter/lib/features/places/place_story.dart) must produce the same results.
const flickr = "https://live.staticflickr.com/65535/53123_abcdef";
const photo = () => ({ src: `${flickr}_b.jpg`, thumbnail: `${flickr}_q.jpg`, width: 1024, height: 768, alt: "Дом с башней",
  author: "Иван Петров", sourceUrl: "https://www.flickr.com/photos/ivan/53123/", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/" });
const detail = () => ({ place: { id: "osm:way:1", name: "Дом с башней", address: "Москва, Арбат, 10", location: { lat: 55.75, lon: 37.59 }, photo: photo(), text: {
  story: { title: "История дома", paragraphs: [{ text: "Первый абзац." }, { text: " " }, null, { text: "Второй абзац." }],
    sources: [{ publisher: "data.mos.ru", url: "https://data.mos.ru/opendata/1" }] },
  audio: { url: "/api/story-audio/a.mp3", durationSec: 61 } } } });


const photoCases: Array<[string, Mutation]> = [
  ["valid flickr", () => undefined],
  ["valid local", p => { p.src = `/api/place-images/${"a".repeat(64)}.jpg`; p.thumbnail = "/images/places/arbat-10.jpg"; p.author = null; }],
  ["blank author becomes null", p => { p.author = " "; }],
  ["flickr sizes swapped", p => { p.src = `${flickr}_q.jpg`; p.thumbnail = `${flickr}_b.jpg`; }],
  ["flickr page of another photo", p => { p.sourceUrl = "https://www.flickr.com/photos/ivan/99999/"; }],
  ["foreign host", p => { p.src = "https://example.org/a.jpg"; p.thumbnail = "https://example.org/b.jpg"; }],
  ["zero width", p => { p.width = 0; }],
  ["empty alt", p => { p.alt = ""; }],
  ["author not a string", p => { p.author = 5; }],
  ["license url not http", p => { p.licenseUrl = "ftp://example.org"; }],
];

const storyCases: Array<[string, Mutation, Locale?]> = [
  ["valid russian", () => undefined],
  ["valid english", d => { d.place.text.localization = { requestedLocale: "en", contentLocale: "en", fallbackReason: null }; d.place.text.audio.language = "en"; }, "en"],
  ["english falls back to russian", d => { d.place.text.localization = { requestedLocale: "en", contentLocale: "ru", fallbackReason: "missing" }; }, "en"],
  ["legacy response for english", () => undefined, "en"],
  ["no audio", d => { d.place.text.audio = null; }],
  ["zero duration is dropped", d => { d.place.text.audio.durationSec = 0; }],
  ["no open data source", d => { d.place.text.story.sources = [{ publisher: "Архив", url: "https://example.org" }]; }],
  ["broken photo is dropped", d => { d.place.photo.width = -1; }],
  ["no header without a name", d => { delete d.place.name; }],
  ["header falls back to the name", d => { delete d.place.text.story.title; delete d.place.address; }],
  ["no story", d => { d.place.text.story = null; }],
  ["paragraphs not a list", d => { d.place.text.story.paragraphs = "text"; }],
  ["localization for another locale", d => { d.place.text.localization = { requestedLocale: "zh", contentLocale: "zh", fallbackReason: null }; }, "en"],
  ["same locale with a fallback reason", d => { d.place.text.localization = { requestedLocale: "en", contentLocale: "en", fallbackReason: "stale" }; }, "en"],
  ["fallback to english", d => { d.place.text.localization = { requestedLocale: "zh", contentLocale: "en", fallbackReason: "missing" }; }, "zh"],
  ["audio in another language", d => { d.place.text.audio.language = "en"; }],
  ["unknown audio language", d => { d.place.text.audio.language = "de"; }],
  ["null body", d => { d.place = null; }],
];

describe("place story fixtures for the mobile app", () => {
  it("exports place story and photo parsing", async () => {
    const photos = photoCases.map(([name, change]) => { const input = mutate(photo, change); return { name, input, result: parsePlacePhoto(input) ?? null }; });
    const stories = storyCases.map(([name, change, locale = "ru"]) => ({ locale, ...verdict(name, mutate(detail, change), value => parsePlaceStory(value, locale)) }));
    expect(photos.filter(item => item.result).length).toBe(3);
    expect(stories.filter(item => !item.valid).map(item => item.name)).toEqual(["no story", "paragraphs not a list", "localization for another locale",
      "same locale with a fallback reason", "fallback to english", "audio in another language", "unknown audio language", "null body"]);
    await expect(stableJson({ photos, stories })).toMatchFileSnapshot(mobileFlutterPath("test/fixtures/api/place_story.json"));
  });
});
