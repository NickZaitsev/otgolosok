import { spawn } from "node:child_process";
import { failure } from "./domain.mjs";

const NORMALIZER_VERSION = "ru-normalizr-0.3.0-tts";
const MAX_NORMALIZED_TEXT_BYTES = 100000;

export function createTextNormalizer({ command = "python3", scriptUrl = new URL("./normalize-tts.py", import.meta.url), spawnImpl = spawn } = {}) {
  return async function normalizeForSpeech(text, { signal } = {}) {
    if (typeof text !== "string" || !text.trim()) throw failure("TTS_FAILED");
    const deadline = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
    return new Promise((resolve, reject) => {
      const child = spawnImpl(command, [scriptUrl.pathname], { stdio: ["pipe", "pipe", "ignore"] });
      const output = [];
      let outputSize = 0;
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        deadline.removeEventListener("abort", abort);
        callback();
      };
      const abort = () => {
        child.kill();
        finish(() => reject(deadline.reason?.name === "AbortError" ? deadline.reason : failure("TTS_FAILED")));
      };
      deadline.addEventListener("abort", abort, { once: true });
      child.once("error", () => finish(() => reject(failure("TTS_FAILED"))));
      child.stdout.on("data", (chunk) => {
        outputSize += chunk.length;
        if (outputSize > MAX_NORMALIZED_TEXT_BYTES) {
          child.kill();
          finish(() => reject(failure("TTS_FAILED")));
          return;
        }
        output.push(chunk);
      });
      child.once("close", (code) => finish(() => {
        if (code !== 0) return reject(failure("TTS_FAILED"));
        const normalized = Buffer.concat(output).toString("utf8").trim();
        if (!normalized) return reject(failure("TTS_FAILED"));
        resolve(normalized);
      }));
      child.stdin.once("error", () => {
        child.kill();
        finish(() => reject(failure("TTS_FAILED")));
      });
      child.stdin.end(text);
    });
  };
}

export const normalizeForSpeech = Object.assign(createTextNormalizer(), { version: NORMALIZER_VERSION });
