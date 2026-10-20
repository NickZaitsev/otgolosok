// Stop hook: if uncommitted changes remain when the agent finishes, remind it once
// to commit them via /commit. One-shot behavior relies on stop_hook_active: Claude Code
// sets it to true when Stop fires after this hook already blocked, so we don't loop.
// Node instead of PowerShell or sh: the repository is worked on from macOS and Windows.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
if (payload.stop_hook_active || !existsSync(".git")) process.exit(0);

let status;
try {
  status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
  process.exit(0);
}
const lines = status.split("\n").filter(Boolean);
if (!lines.length) process.exit(0);

const reason =
  `Uncommitted changes remain in the working tree:\n${lines.slice(0, 20).join("\n")}\n` +
  "If the task is finished, commit them as atomic conventional commits (/commit skill). " +
  "If this is unfinished work or files left on purpose, just finish your reply.";
process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
