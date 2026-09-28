import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {centreVerticalScore, prepareCentreVerticalVideo} from "../scripts/prepare-centre-vertical-video.mjs";
import {CENTRE_STOPS} from "./centre-geometry";
import {
  CENTRE_VERTICAL_DURATION_IN_FRAMES,
  CENTRE_VERTICAL_FPS,
  CENTRE_VERTICAL_PLACES,
  CENTRE_VERTICAL_SCENES,
  CENTRE_VERTICAL_VOICE,
} from "./centre-vertical-timeline";

const scene = (id: string) => CENTRE_VERTICAL_SCENES.find((item) => item.id === id)!;

describe("вертикальный ролик о прогулке по центру", () => {
  it("идёт 30 секунд, сцены стыкуются без дыр", () => {
    expect(CENTRE_VERTICAL_DURATION_IN_FRAMES / CENTRE_VERTICAL_FPS).toBe(30);
    CENTRE_VERTICAL_SCENES.slice(1).forEach((item, index) => expect(item.start).toBe(CENTRE_VERTICAL_SCENES[index].end));
  });

  it("показывает знаковые места из опубликованной прогулки, по месту не меньше чем на 0,8 с", () => {
    const place = scene("place");
    expect(CENTRE_VERTICAL_PLACES.length).toBeGreaterThanOrEqual(3);
    for (const {stop, index, at} of CENTRE_VERTICAL_PLACES) {
      expect(CENTRE_STOPS[index]).toBe(stop);
      expect(at).toBeGreaterThan(0);
      expect(place.start + at).toBeLessThan(place.end);
    }
    CENTRE_VERTICAL_PLACES.slice(1).forEach(({at}, order) => expect(at - CENTRE_VERTICAL_PLACES[order].at).toBeGreaterThanOrEqual(24));
    // Последнее место успевает прочитаться до склейки.
    expect(place.start + CENTRE_VERTICAL_PLACES.at(-1)!.at + 24).toBeLessThanOrEqual(place.end);
  });

  it("проигрывает одно целое предложение озвучки внутри сцены «listen»", () => {
    const voice = CENTRE_VERTICAL_VOICE;
    expect(voice.sentence).toBe("Его композицию образуют девять самостоятельных столпообразных церквей, объединённых галереями.");
    expect(voice.fromSec).toBeLessThan(voice.speechSec);
    expect(voice.speechSec).toBeLessThan(voice.toSec);
    expect(voice.toSec).toBeLessThan(voice.audio.durationSec);
    expect(voice.delay + (voice.toSec + 0.3 - voice.fromSec) * CENTRE_VERTICAL_FPS).toBeLessThan(scene("listen").end - scene("listen").start);
  });

  it("ставит удары на склейки, приглушение под голос и щелчки на места", () => {
    const score = centreVerticalScore();
    const frames = (times: number[]) => times.map((time) => Math.round(time * CENTRE_VERTICAL_FPS));
    expect(score.seconds * CENTRE_VERTICAL_FPS).toBe(CENTRE_VERTICAL_DURATION_IN_FRAMES);
    expect(frames(score.cuts)).toEqual(CENTRE_VERTICAL_SCENES.slice(1).map(({start}) => start));
    expect(frames(score.duck!)).toEqual([scene("listen").start, scene("listen").end]);
    expect(frames(score.taps)).toEqual(CENTRE_VERTICAL_PLACES.map(({at}) => scene("place").start + at));
  });
});

describe("подготовка материалов", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, {recursive: true, force: true});
  });

  it("сначала готовит озвучку, потом пишет музыку в WAV", async () => {
    dir = await mkdtemp(join(tmpdir(), "centre-vertical-"));
    const prepared: string[] = [];
    await prepareCentreVerticalVideo(dir, {prepareStory: async (publicDir: string) => void prepared.push(publicDir)});
    expect(prepared).toEqual([dir]);
    const wav = await readFile(join(dir, "centre/vertical-bed.wav"));
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
  });

  it("не пишет музыку, если озвучку подготовить не удалось", async () => {
    dir = await mkdtemp(join(tmpdir(), "centre-vertical-"));
    const failing = async () => {
      throw new Error("хеш озвучки не совпал");
    };
    await expect(prepareCentreVerticalVideo(dir, {prepareStory: failing})).rejects.toThrow("хеш озвучки не совпал");
    await expect(readFile(join(dir, "centre/vertical-bed.wav"))).rejects.toThrow();
  });
});
