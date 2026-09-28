import {describe, expect, it} from "vitest";
import manifest from "../../video/assets/guide/create-ad/voice/manifest.json";
import narration from "./create-ad-narration.json";
import {CREATE_AD_DURATION_IN_FRAMES, CREATE_AD_FPS, CREATE_AD_SCENES, CREATE_AD_TAPS, CREATE_AD_TRANSITION_FRAMES, CREATE_AD_VOICE_FRAME, getCreateAdFrameState, tapAt} from "./create-ad-timeline";

describe("реклама создания прогулки", () => {
  it("короче 30 секунд и идёт сценами без дыр", () => {
    expect(CREATE_AD_DURATION_IN_FRAMES / CREATE_AD_FPS).toBeLessThanOrEqual(30);
    expect(CREATE_AD_SCENES.map(({id}) => id)).toEqual(["hook", "start", "time", "build", "walk", "brand"]);
    for (let index = 1; index < CREATE_AD_SCENES.length; index += 1) {
      expect(CREATE_AD_SCENES[index].start).toBe(CREATE_AD_SCENES[index - 1].end);
    }
  });

  it("нажимает только после перехода и до конца своей сцены", () => {
    for (const [id, frames] of Object.entries(CREATE_AD_TAPS)) {
      const scene = CREATE_AD_SCENES.find((item) => item.id === id);
      expect(scene, id).toBeDefined();
      for (const frame of frames ?? []) {
        expect(frame).toBeGreaterThanOrEqual(CREATE_AD_TRANSITION_FRAMES);
        expect(scene!.start + frame).toBeLessThan(scene!.end);
        expect(getCreateAdFrameState(scene!.start + frame).id).toBe(id);
      }
    }
  });

  it("начинает фрагмент истории с 20-й секунды и договаривает его до конца ролика", () => {
    expect(CREATE_AD_VOICE_FRAME / CREATE_AD_FPS).toBe(20);
    // Клип озвучен по текущему тексту: иначе после правки текста в ролик попадёт старая фраза.
    expect(manifest.story.text).toBe(narration.story);
    expect(CREATE_AD_VOICE_FRAME + manifest.story.durationSeconds * CREATE_AD_FPS).toBeLessThanOrEqual(CREATE_AD_DURATION_IN_FRAMES);
  });

  it("сообщает о сцене без нажатия", () => {
    expect(tapAt("time")).toBe(52);
    expect(() => tapAt("brand")).toThrow(/нет нажатия/);
  });
});
