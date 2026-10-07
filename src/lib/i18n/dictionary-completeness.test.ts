import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { translations } from "./translate";

const root = fileURLToPath(new URL("../../", import.meta.url));
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "dictionaries" || entry.name === "admin" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}
const placeholders = (text: string) => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match => match[1]).sort();

describe("полнота переводов публичного интерфейса", () => {
  it("содержит оба перевода каждой вынесенной статической строки", () => {
    const missing: string[] = [];
    for (const file of sourceFiles(root)) {
      const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const name = node.expression.getText(tree);
          const index = name === "t" || name.endsWith(".t") ? 0 : name === "translate" || name === "toUserMessage" ? 1 : -1;
          const value = index >= 0 ? node.arguments[index] : undefined;
          if (value) {
            const check = (part: ts.Node) => {
              if ((ts.isStringLiteral(part) || ts.isNoSubstitutionTemplateLiteral(part)) && /[А-Яа-яЁё]/.test(part.text) && !Object.hasOwn(translations, part.text)) missing.push(`${file.slice(root.length + 1)}: ${part.text}`);
              ts.forEachChild(part, check);
            };
            check(value);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    expect([...new Set(missing)], "Пропущенные строки интерфейса").toEqual([]);
  });
  it("не оставляет русские подписи напрямую в публичном JSX", () => {
    const untranslated: string[] = [];
    for (const file of sourceFiles(`${root}/features`)) {
      if (file.endsWith("/brand-mark.tsx")) continue; // Собственное имя бренда одинаково во всех языках.
      const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        const text = ts.isJsxText(node) ? node.text : ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) ? node.initializer.text : "";
        if (/[А-Яа-яЁё]/.test(text)) untranslated.push(`${file.slice(root.length + 1)}: ${text.trim()}`);
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    expect(untranslated).toEqual([]);
  });
  it("сохраняет все именованные параметры и непустые значения", () => {
    for (const [source, pair] of Object.entries(translations)) {
      for (const text of pair) {
        expect(text.trim(), source).not.toBe("");
        expect(placeholders(text), source).toEqual(placeholders(source));
      }
    }
  });
});
