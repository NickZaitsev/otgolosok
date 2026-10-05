import { describe, expect, it, vi } from "vitest";
import { nativeShareEnvironment, type SharePlugin } from "./app-share";
import { sharePlace } from "./share-place";

const place = { title: "Дом Пашкова", url: "https://otgolosok.online/place/way/5" };

function setup(share: SharePlugin["share"]) {
  const writeText = vi.fn(async (text: string) => { void text; });
  const env = nativeShareEnvironment(async () => ({ share }), { writeText });
  return { env, writeText };
}

describe("sharing a place in the app", () => {
  it("opens the system sheet with the title, the text and the link", async () => {
    const share = vi.fn(async () => undefined);
    const { env, writeText } = setup(share);

    expect(await sharePlace(place, env)).toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: "Дом Пашкова",
      text: "Дом Пашкова — история в «Отголоске»",
      url: place.url,
      dialogTitle: "Поделиться",
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("treats a closed sheet as cancelled, not as a failure", async () => {
    const { env, writeText } = setup(vi.fn(async () => { throw new Error("Share canceled"); }));

    expect(await sharePlace(place, env)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the link when the sheet cannot open", async () => {
    const { env, writeText } = setup(vi.fn(async () => { throw new Error("Can't share while sharing is in progress"); }));

    expect(await sharePlace(place, env)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(place.url);
  });

  it("copies the link when the plugin code fails to load", async () => {
    const writeText = vi.fn(async (text: string) => { void text; });
    const env = nativeShareEnvironment(async () => { throw new Error("ChunkLoadError"); }, { writeText });

    expect(await sharePlace(place, env)).toBe("copied");
  });
});
