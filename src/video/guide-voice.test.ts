import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {createHash} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";
import {buildGuideVoice, clipKey, isTransient, withRetry} from "../../scripts/build-guide-voice.mjs";

const profile = {id: "f5-ru-v1", voice: "obrazec6", modelSha256: "m", configSha256: "c", referenceSha256: "r", preparationVersion: "p"};
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, {recursive: true, force: true})));
});

describe("озвучка видеоинструкции", () => {
  it("ключ клипа меняется при смене текста или профиля", () => {
    const base = clipKey("Текст", profile);
    expect(clipKey("Текст", profile)).toBe(base);
    expect(clipKey("Текст.", profile)).not.toBe(base);
    expect(clipKey("Текст", {...profile, configSha256: "другой"})).not.toBe(base);
  });

  it.each([
    [{transient: true}, true],
    [{status: 429}, true],
    [{status: 503}, true],
    [{status: 400}, false],
    [{status: 401}, false],
    [new Error("логика"), false],
  ])("повтор для %o: %s", (error, expected) => {
    expect(isTransient(error)).toBe(expected);
  });

  it("повторяет временные сбои с растущей паузой и останавливается на постоянной ошибке", async () => {
    const sleep = vi.fn(async () => {});
    const flaky = vi.fn().mockRejectedValueOnce({status: 502}).mockRejectedValueOnce({transient: true}).mockResolvedValue("ok");
    await expect(withRetry(flaky, {sleep, baseDelayMs: 100})).resolves.toBe("ok");
    expect(sleep.mock.calls).toEqual([[100], [200]]);

    const denied = vi.fn().mockRejectedValue({status: 403});
    await expect(withRetry(denied, {sleep})).rejects.toEqual({status: 403});
    expect(denied).toHaveBeenCalledTimes(1);

    const down = vi.fn().mockRejectedValue({status: 500});
    await expect(withRetry(down, {sleep, attempts: 3})).rejects.toEqual({status: 500});
    expect(down).toHaveBeenCalledTimes(3);
  });

  it("сохраняет MP3 и manifest, подтверждает приём и не синтезирует повторно", async () => {
    const root = await mkdtemp(join(tmpdir(), "otgolosok-voice-"));
    tempDirs.push(root);
    await mkdir(join(root, "src/video"), {recursive: true});
    await writeFile(join(root, "src/video/guide-narration.json"), JSON.stringify({intro: "Привет."}));
    // Реальный MP3 нужен ffprobe для измерения длительности.
    const bytes = await readFile("video/assets/guide/voice/intro.mp3");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await mkdir(join(root, "node_modules/@remotion"), {recursive: true});
    await import("node:fs/promises").then(fs => fs.symlink(resolve("node_modules/@remotion/cli"), join(root, "node_modules/@remotion/cli"), "junction"));
    const client = {
      profiles: vi.fn(async () => [profile]),
      create: vi.fn<(request: unknown) => Promise<{id: string; state: string}>>(async () => ({id: "job-1", state: "succeeded"})),
      get: vi.fn(async () => ({id: "job-1", state: "succeeded", result: {sha256}})),
      audio: vi.fn(async () => ({bytes, sha256})),
      ack: vi.fn(async () => {}),
    };
    const manifest = await buildGuideVoice({root, client, log: () => {}});
    expect(manifest.intro).toMatchObject({text: "Привет.", sha256, profile: "f5-ru-v1"});
    expect(manifest.intro.durationSeconds).toBeGreaterThan(0);
    expect(await readFile(join(root, "video/assets/guide/voice/intro.mp3"))).toEqual(bytes);
    expect(client.ack).toHaveBeenCalledWith("job-1", sha256);
    expect(client.create.mock.calls[0][0]).toMatchObject({profileId: "f5-ru-v1", text: "Привет.", expected: {modelSha256: "m"}});

    await buildGuideVoice({root, client, log: () => {}});
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it("отклоняет аудио с неверной контрольной суммой и не подтверждает его", async () => {
    const root = await mkdtemp(join(tmpdir(), "otgolosok-voice-"));
    tempDirs.push(root);
    await mkdir(join(root, "src/video"), {recursive: true});
    await writeFile(join(root, "src/video/guide-narration.json"), JSON.stringify({intro: "Привет."}));
    const bytes = Buffer.from("не mp3");
    const client = {
      profiles: vi.fn(async () => [profile]),
      create: vi.fn(async () => ({id: "job-2", state: "succeeded"})),
      get: vi.fn(async () => ({id: "job-2", state: "succeeded", result: {sha256: "подмена"}})),
      audio: vi.fn(async () => ({bytes, sha256: "подмена"})),
      ack: vi.fn(),
    };
    await expect(buildGuideVoice({root, client, log: () => {}})).rejects.toThrow("Контрольная сумма");
    expect(client.ack).not.toHaveBeenCalled();
  });

  it("сообщает об отсутствующем профиле", async () => {
    const root = await mkdtemp(join(tmpdir(), "otgolosok-voice-"));
    tempDirs.push(root);
    await mkdir(join(root, "src/video"), {recursive: true});
    await writeFile(join(root, "src/video/guide-narration.json"), "{}");
    const client = {profiles: vi.fn(async () => []), create: vi.fn(), get: vi.fn(), audio: vi.fn(), ack: vi.fn()};
    await expect(buildGuideVoice({root, client, log: () => {}})).rejects.toThrow("f5-ru-v1");
  });
});
