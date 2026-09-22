#!/usr/bin/env node
// Checks SpeechKit narration markup for stress marks that break a word's pronunciation.
//   node scripts/check-stress.mjs < chapter.txt          report only, exits 1 when something is unsafe
//   node scripts/check-stress.mjs --fix < chapter.txt    write the corrected markup to stdout
//   node scripts/check-stress.mjs --fix --high < in.txt  drop only the marks SpeechKit is least likely to survive
import { readFile } from "node:fs/promises";
import { findUnsafeStress, stripUnsafeStress } from "../backend/stress-safety.mjs";

const args = process.argv.slice(2);
const fix = args.includes("--fix");
const severity = args.includes("--high") ? "high" : "medium";
const file = args.find((argument) => !argument.startsWith("--"));

const source = file ? await readFile(file, "utf8") : await new Response(process.stdin).text();
const { text, removed } = stripUnsafeStress(source, { severity });

if (fix) {
  process.stdout.write(text);
} else {
  for (const item of findUnsafeStress(source)) {
    const line = source.slice(0, item.index).split("\n").length;
    process.stderr.write(`${file ?? "stdin"}:${line}  ${item.word}  → снять ударение: ${item.note} [${item.severity}]\n`);
  }
}
process.exit(removed.length ? 1 : 0);
