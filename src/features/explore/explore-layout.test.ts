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
      /aria-labelledby="new-place-title"[\s\S]*className="around-primary"[\s\S]*className="around-secondary"[^>]*>Создать прогулку отсюда[\s\S]*<\/section>/,
    );
    expect(css).toMatch(
      /\.around-place-card \.around-primary\+\.around-secondary\{margin-top:10px\}/,
    );
  });

  it("балансирует перенос заголовка карточки геолокации", () => {
    expect(css).toMatch(/\.around-location-card h2\{text-wrap:balance\}/);
  });

  it("не перекрывает размер текста кнопок нижней навигации", () => {
    expect(css).toContain(".around-shell :where(button,input){font:inherit}");
    expect(css).not.toContain(".around-shell button,.around-shell input{font:inherit}");
  });
});
