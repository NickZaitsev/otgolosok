import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";

const output = new URL("../out/", import.meta.url);
const files = (await readdir(output, { recursive: true })).filter((file) =>
  ["index.html", "create.html", "icon.svg", "favicon.ico", "manifest.webmanifest"].includes(file) ||
  /^(?:_next\/static|data|audio)\/.+\.[^/]+$/.test(file),
).sort();
const template = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const hash = createHash("sha256").update(template);

for (const file of files) {
  hash.update(file).update(await readFile(new URL(file, output)));
}

const manifest = {
  version: hash.digest("hex").slice(0, 16),
  assets: files.map((file) => file === "index.html" ? "/" : file === "create.html" ? "/create" : `/${file}`),
};

await writeFile(
  new URL("sw.js", output),
  `self.__PRECACHE = ${JSON.stringify(manifest)};\n${template}`,
);
console.log(`Service Worker: ${manifest.assets.length} files, version ${manifest.version}`);
