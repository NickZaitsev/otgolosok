import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Claude Code reads .claude/skills, Codex reads .agents/skills. Git stores both
// copies as plain files (the team works on Windows, where a checkout may join them
// with a directory junction), so a clone without the junction must not drift.
const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, ".claude", "skills");
const copy = join(root, ".agents", "skills");

/** @param {string} directory */
function files(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name).slice(directory.length + 1).replaceAll("\\", "/"))
    .sort();
}

test("копии навыков агентов в .agents/skills совпадают с .claude/skills", () => {
  const names = files(source);
  assert.ok(names.length > 0, "в .claude/skills нет навыков");
  assert.deepEqual(files(copy), names, "набор файлов навыков различается — скопируйте .claude/skills в .agents/skills");
  for (const name of names) {
    assert.ok(readFileSync(join(copy, name)).equals(readFileSync(join(source, name))), `${name} отличается — скопируйте его из .claude/skills`);
  }
});
