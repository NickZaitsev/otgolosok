import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {prepareVideoAssets, videoAssets} from "../../scripts/prepare-video-assets.mjs";

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
  return {root, publicDir: join(root, "staged-public")};
}

describe("подготовка материалов Remotion", () => {
  it("копирует каждый ресурс в отдельный каталог с ожидаемым путём", async () => {
    const {root, publicDir} = await fixture();
    await prepareVideoAssets(root, publicDir);

    for (const [source, destination] of videoAssets) {
      expect(await readFile(join(publicDir, destination), "utf8")).toBe(source);
    }
  });

  it("явно сообщает об отсутствующем источнике", async () => {
    const {root, publicDir} = await fixture();
    await rm(join(root, videoAssets[0][0]));
    await expect(prepareVideoAssets(root, publicDir)).rejects.toMatchObject({code: "ENOENT"});
  });
});
