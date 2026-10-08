import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const run = (command, args, { binary = false } = {}) => {
  const r = spawnSync(command, args, {
    encoding: binary ? null : "utf8",
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.error || r.status !== 0)
    throw new Error(
      `${command} не завершился успешно: ${r.error?.message ?? String(r.stderr).slice(-1000)}`,
    );
  return r.stdout;
};
const path = process.argv[2] ?? "renders/bolshoy-kamenny-most-full.mp4";
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const expected = JSON.parse(readFileSync("audio-source-proof.json", "utf8"));
const source = readFileSync("assets/narration.mp3");
if (sha(source) !== expected.sha256) throw new Error("Изменён исходный MP3");
const story = readFileSync("narration.txt", "utf8").trim().replace(/\s+/g, " ");
const captions = JSON.parse(readFileSync("captions.json", "utf8"));
if (captions.map((c) => c.text).join(" ") !== story)
  throw new Error("Субтитры не покрывают полный исходный текст");
if (
  captions.some(
    (c, i) => c.end <= c.start || (i && c.start < captions[i - 1].end),
  )
)
  throw new Error("Невалидные либо перекрывающиеся субтитры");
const probe = JSON.parse(
  run("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    path,
  ]),
);
const video = probe.streams.find((s) => s.codec_type === "video");
const audio = probe.streams.find((s) => s.codec_type === "audio");
if (!video || !audio) throw new Error("В MP4 отсутствует видео или звук");
if (
  video.width !== 1080 ||
  video.height !== 1920 ||
  video.avg_frame_rate !== "30/1"
)
  throw new Error("Не совпадают разрешение или частота кадров");
const renderDuration = Number(probe.format.duration);
if (Math.abs(renderDuration - 79.488) > 0.05)
  throw new Error("Неверная длительность готового видео");
const decode = (file) =>
  run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { binary: true },
  );
const original = decode("assets/narration.mp3"),
  rendered = decode(path);
const n = Math.min(original.length, rendered.length) / 2;
const correlation = (from, to, lag = 0) => {
  let aa = 0,
    bb = 0,
    ab = 0;
  const a = Math.max(0, Math.floor(from * 24000)),
    b = Math.min(n, Math.floor(to * 24000));
  for (let i = a; i < b; i++) {
    const j = i + lag;
    if (j < 0 || j * 2 + 1 >= rendered.length) continue;
    const x = original.readInt16LE(i * 2),
      y = rendered.readInt16LE(j * 2);
    aa += x * x;
    bb += y * y;
    ab += x * y;
  }
  return ab / Math.sqrt(aa * bb);
};
const windows = [
  [0, 10],
  [34, 44],
  [69, n / 24000],
].map(([start, end]) => ({ start, end, correlation: correlation(start, end) }));
if (windows.some((w) => w.correlation < 0.98))
  throw new Error(
    "Изменены звук, скорость или синхронизация в MP4: " +
      JSON.stringify(windows),
  );
if (rendered.length / 48000 + 0.04 < original.length / 48000)
  throw new Error("Обрезан исходный звук");
const check = JSON.parse(readFileSync("check-final.json", "utf8"));
if (
  !check.ok ||
  check.browserSkipped ||
  !check.motion.enabled ||
  check.lint.warningCount
)
  throw new Error("Не пройдены окончательные проверки HyperFrames");
const seams = JSON.parse(readFileSync("seam-check.json", "utf8"));
if (seams.some((s) => s.rows.some((r) => r.status === "FAIL")))
  throw new Error("Не пройдена проверка переходов");
const result = {
  checkedAt: new Date().toISOString(),
  complete: true,
  output: path,
  sha256: sha(readFileSync(path)),
  bytes: Number(probe.format.size),
  width: video.width,
  height: video.height,
  fps: 30,
  frames: Number(video.nb_frames),
  durationSec: renderDuration,
  videoCodec: video.codec_name,
  audioCodec: audio.codec_name,
  originalAudioSha256: expected.sha256,
  provider: expected.provider,
  model: expected.model,
  voiceName: expected.voiceName,
  sourceAudioUnchanged: true,
  fullNarrationAndPunctuationInCaptions: true,
  captionCues: captions.length,
  sourceDecodedDurationSec: original.length / 48000,
  renderedDecodedAudioDurationSec: rendered.length / 48000,
  audioCorrelationWindows: windows,
  hyperframes: {
    version: check._meta.version,
    strict: check.strict,
    lintErrors: check.lint.errorCount,
    lintWarnings: check.lint.warningCount,
    runtimeErrors: check.runtime.errorCount,
    layoutErrors: check.layout.errorCount,
    motionSamples: check.motion.samples,
    contrastChecks: check.contrast.checked,
  },
  seams: { count: seams.length, allPassed: true },
  youtubePublished: false,
};
writeFileSync("verification.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
