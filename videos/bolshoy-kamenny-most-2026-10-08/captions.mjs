import { readFileSync, writeFileSync } from "node:fs";
const source = readFileSync("narration.txt", "utf8")
  .trim()
  .replaceAll("Москва — Волга", "Москва—Волга")
  .split(/\s+/);
const heard = JSON.parse(readFileSync("transcript.json", "utf8"));
const norm = (s) =>
  s
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace("xvii", "17")
    .replace("xix", "19")
    .replace(/[^а-яa-z0-9]/g, "");
const distance = (a, b) => {
  const p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = p[0];
    p[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = p[j];
      p[j] = Math.min(
        p[j] + 1,
        p[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = old;
    }
  }
  return p[b.length] / Math.max(a.length, b.length, 1);
};
const dp = Array.from({ length: source.length + 1 }, () =>
  Array(heard.length + 1).fill(Infinity),
);
const trace = Array.from({ length: source.length + 1 }, () =>
  Array(heard.length + 1),
);
dp[0][0] = 0;
for (let i = 0; i <= source.length; i++)
  for (let j = 0; j <= heard.length; j++) {
    const update = (x, y, c, move) => {
      if (dp[i][j] + c < dp[x][y]) {
        dp[x][y] = dp[i][j] + c;
        trace[x][y] = move;
      }
    };
    if (i < source.length && j < heard.length)
      for (let k = 1; k <= 3 && j + k <= heard.length; k++)
        update(
          i + 1,
          j + k,
          distance(
            norm(source[i]),
            heard
              .slice(j, j + k)
              .map((x) => norm(x.text))
              .join(""),
          ) +
            (k - 1) * 0.03,
          [i, j, 1, k],
        );
    if (i < source.length) update(i + 1, j, 1.05, [i, j, 1, 0]);
    if (j < heard.length) update(i, j + 1, 0.95, [i, j, 0, 1]);
  }
let i = source.length,
  j = heard.length;
const words = [],
  omissions = [];
while (i || j) {
  const [pi, pj, sc, hc] = trace[i][j];
  if (sc) {
    const hs = heard.slice(pj, pj + hc);
    words.push({
      text: source[pi].replaceAll("Москва—Волга", "Москва — Волга"),
      start: hs[0]?.start,
      end: hs.at(-1)?.end,
      heard: hs.map((x) => x.text).join(" "),
    });
    if (!hc) omissions.push(source[pi]);
  }
  i = pi;
  j = pj;
}
words.reverse();
if (omissions.length)
  throw new Error("Words without audio alignment: " + omissions.join(", "));
const cues = [];
let cue = [];
for (const word of words) {
  const candidate = [...cue, word];
  const text = candidate.map((x) => x.text).join(" ");
  if (cue.length && (text.length > 43 || word.end - cue[0].start > 3.3)) {
    cues.push(cue);
    cue = [];
  }
  cue.push(word);
  if (/[.!?]$/.test(word.text) && cue.length > 1) {
    cues.push(cue);
    cue = [];
  }
}
if (cue.length) cues.push(cue);
const captions = cues.map((c) => ({
  start: c[0].start,
  end: c.at(-1).end,
  text: c.map((x) => x.text).join(" "),
}));
writeFileSync("captions.json", JSON.stringify(captions, null, 2) + "\n");
writeFileSync("aligned-words.json", JSON.stringify(words, null, 2) + "\n");
const time = (n) => {
  let ms = Math.round(n * 1000);
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
writeFileSync(
  "subtitles.srt",
  captions
    .map((c, i) => `${i + 1}\n${time(c.start)} --> ${time(c.end)}\n${c.text}\n`)
    .join("\n"),
);
console.log(
  JSON.stringify(
    {
      sourceWords: source.length,
      asrWords: heard.length,
      cues: captions.length,
      unaligned: omissions,
      score: dp[source.length][heard.length],
      corrections: words.filter((w) => norm(w.text) !== norm(w.heard)),
    },
    null,
    2,
  ),
);
