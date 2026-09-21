import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./explore.css", import.meta.url)), "utf8");
const screen = readFileSync(fileURLToPath(new URL("./around-screen.tsx", import.meta.url)), "utf8");

describe("раскладка карточки места", () => {
  it("ограничивает всю нижнюю панель областью между шапкой и навигацией", () => {
    expect(css).toMatch(
      /\.around-bottom\{[^}]*max-height:calc\(100% - var\(--around-sheet-top\) - var\(--around-nav-height\) - 16px\)/,
    );
    expect(css).toMatch(
      /\.around-bottom>\.around-place-card\{[^}]*min-height:0/,
    );
  });

  it("показывает создание прогулки как второстепенное действие", () => {
    expect(screen).toMatch(
      /className="around-secondary"[^>]*>Создать прогулку отсюда/,
    );
    expect(css).toMatch(
      /\.around-bottom>\.around-place-card\+\.around-secondary\{margin-top:12px\}/,
    );
  });
});
