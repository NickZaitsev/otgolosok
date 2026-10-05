// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { inAppPathFromUrl, openInAppPath } from "./app-links";

const ORIGIN = "https://otgolosok.online";

describe("inAppPathFromUrl", () => {
  it.each([
    ["/place/node/123", "/?place=osm:node:123"],
    ["/place/way/5", "/?place=osm:way:5"],
    ["/place/relation/7", "/?place=osm:relation:7"],
    ["/", "/"],
    ["/?place=osm:node:1", "/?place=osm:node:1"],
    ["/?job=abc", "/?job=abc"],
    ["/walk?share=t0ken", "/walk?share=t0ken"],
  ])("opens %s as %s", (path, expected) => {
    expect(inAppPathFromUrl(`${ORIGIN}${path}`, ORIGIN)).toBe(expected);
  });

  it.each([
    ["the API", `${ORIGIN}/api/places`],
    ["the admin", `${ORIGIN}/admin`],
    ["the update page", `${ORIGIN}/update.html`],
    ["another host", "https://evil.example/place/node/1"],
    ["a lookalike subdomain", "https://otgolosok.online.evil.example/"],
    ["plain http", "http://otgolosok.online/"],
    ["a damaged place link", `${ORIGIN}/place/node/abc`],
    ["a place id with a leading zero", `${ORIGIN}/place/node/0123`],
    ["an unknown place type", `${ORIGIN}/place/area/1`],
    ["not a URL", "otgolosok"],
  ])("ignores %s", (_, url) => {
    expect(inAppPathFromUrl(url, ORIGIN)).toBeNull();
  });
});

describe("openInAppPath", () => {
  afterEach(() => history.replaceState({}, "", "/"));

  function page(pathname: string, search = "") {
    return { pathname, search, assign: vi.fn() };
  }

  it("shows a place on the open map without reloading it, even during a walk", () => {
    const confirmLeave = vi.fn(() => false);
    const current = page("/");
    const push = vi.spyOn(history, "pushState");

    openInAppPath("/?place=osm:node:1", { confirmLeave }, current);

    expect(push).toHaveBeenCalledWith({}, "", "/?place=osm:node:1");
    expect(current.assign).not.toHaveBeenCalled();
    expect(confirmLeave).not.toHaveBeenCalled();
  });

  it("navigates to another page when leaving is allowed", () => {
    const current = page("/walk", "?id=1");

    openInAppPath("/?place=osm:node:1", { confirmLeave: () => true }, current);

    expect(current.assign).toHaveBeenCalledWith("/?place=osm:node:1");
  });

  it("keeps the page when the walker refuses to leave", () => {
    const current = page("/");

    openInAppPath("/walk?share=t", { confirmLeave: () => false }, current);

    expect(current.assign).not.toHaveBeenCalled();
  });

  it("does nothing for the page already shown", () => {
    const confirmLeave = vi.fn(() => true);
    const current = page("/walk", "?share=t");

    openInAppPath("/walk?share=t", { confirmLeave }, current);

    expect(current.assign).not.toHaveBeenCalled();
    expect(confirmLeave).not.toHaveBeenCalled();
  });
});
