import { existsSync, globSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppIcon } from "./app-icon";

describe("AppIcon", () => {
  it("renders a decorative Lucide icon with consistent defaults", () => {
    const markup = renderToStaticMarkup(createElement(AppIcon, { name: "map" }));

    expect(markup).toContain('class="lucide lucide-map"');
    expect(markup).toContain('width="24"');
    expect(markup).toContain('stroke-width="1.8"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
  });

  it("allows a control to choose a smaller icon", () => {
    const markup = renderToStaticMarkup(createElement(AppIcon, { name: "edit", size: 18 }));

    expect(markup).toContain('class="lucide lucide-pencil"');
    expect(markup).toContain('width="18"');
  });

  it("keeps feature components free of handmade inline SVG icons", () => {
    const features = new URL("../", import.meta.url);
    const inlineSvg = globSync("**/*.tsx", { cwd: features }).filter((file) =>
      readFileSync(new URL(file, features), "utf8").includes("<svg"),
    );

    expect(inlineSvg).toEqual([]);
    expect(existsSync(new URL("../explore/icons.tsx", import.meta.url))).toBe(false);
  });
});
