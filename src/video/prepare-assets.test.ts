import {copyFile, mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {motionScore, prepareVideoAssets, stripRouteLayer, videoAssets} from "../../scripts/prepare-video-assets.mjs";
import {motionBedWav} from "../../scripts/build-motion-audio.mjs";

const MAP = "public/data/maps/paveletskaya.svg";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, {recursive: true, force: true})));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "otgolosok-video-"));
  tempDirs.push(root);
  for (const [source] of videoAssets) {
    const path = join(root, source);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, source);
  }
  // Подложку моушн-ролика строим из настоящей карты.
  await copyFile(MAP, join(root, MAP));
  return {root, publicDir: join(root, "staged-public")};
}

describe("подготовка материалов Remotion", () => {
  it("копирует каждый ресурс в отдельный каталог с ожидаемым путём", async () => {
    const {root, publicDir} = await fixture();
    await prepareVideoAssets(root, publicDir, {bedSeconds: 1});

    for (const [source, destination] of videoAssets) {
      expect(await readFile(join(publicDir, destination), "utf8")).toBe(await readFile(join(root, source), "utf8"));
    }
    // Фон и щелчок инструкции синтезируются, а не копируются.
    for (const generated of ["guide/bed.wav", "guide/click.wav", "motion/bed.wav"]) {
      expect((await readFile(join(publicDir, generated))).toString("ascii", 0, 4)).toBe("RIFF");
    }
  });

  it("явно сообщает об отсутствующем источнике", async () => {
    const {root, publicDir} = await fixture();
    await rm(join(root, videoAssets[0][0]));
    await expect(prepareVideoAssets(root, publicDir)).rejects.toMatchObject({code: "ENOENT"});
  });
});

describe("материалы моушн-ролика", () => {
  it("убирает с подложки карты маршрут и метки, сохраняя сам город", async () => {
    const map = await readFile(MAP, "utf8");
    const base = stripRouteLayer(map);
    expect(base).not.toMatch(/walking-path"|walk-path-halo"|data-step=|class="poi-label"/);
    expect(base).toContain('class="water"');
    expect(base.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("падает, если разметка маршрута на карте изменилась", async () => {
    const map = await readFile(MAP, "utf8");
    expect(() => stripRouteLayer(map.replace(/<g data-step="zindel".*?<\/g>/, ""))).toThrow(/ожидалось 4/);
  });

  it("строит партитуру по склейкам ролика", () => {
    expect(motionScore()).toEqual({seconds: 30, cuts: [4, 9, 16, 23, 26], duck: [16, 23], groove: 4, finale: 26});
  });

  it("синтезирует музыку нужной длины без клиппинга", () => {
    const wav = motionBedWav(motionScore());
    const samples = (wav.length - 44) / 2;
    expect(samples).toBe(30 * 32000);
    let peak = 0;
    for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
    expect(peak).toBeGreaterThan(8000);
    expect(peak).toBeLessThan(32767);
  });

  it("не принимает склейку за пределами ролика", () => {
    expect(() => motionBedWav({...motionScore(), cuts: [31]})).toThrow(RangeError);
  });
});
