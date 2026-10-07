import { appendFileSync } from "node:fs";
import { test } from "./support/test";
import { applyLayoutCase, collectViolations, expectLayout, layoutCases, type KnownFailure } from "./support/layout";
import { SCREEN_STATES } from "./support/scenarios";

/**
 * Layout defects that still exist. Each entry must keep failing: when a defect is
 * fixed the run fails until the entry is removed, so the list only shrinks.
 */
const KNOWN_LAYOUT_FAILURES: KnownFailure[] = [
];

// LAYOUT_DUMP=<file> records the violations of every case instead of asserting — used to audit the matrix.
const dump = process.env.LAYOUT_DUMP;

for (const { screen, state, options, open, chromiumOnly } of SCREEN_STATES) {
  test.describe(`${screen} / ${state}`, () => {
    // Chromium has the superset of cases; other browsers skip the ones they do not run.
    for (const layout of layoutCases("chromium")) {
      test(layout.name, async ({ page, browserName }) => {
        test.skip(!layoutCases(browserName).some(item => item.name === layout.name), "вариант только для Chromium");
        test.skip(Boolean(chromiumOnly) && browserName !== "chromium", chromiumOnly);
        await applyLayoutCase(page, layout);
        await open(page);
        if (dump) {
          await page.waitForTimeout(1500);
          const violations = await collectViolations(page, options, layout.safeArea);
          appendFileSync(dump, JSON.stringify({ browserName, screen, state, layout: layout.name, violations }) + "\n");
          return;
        }
        await expectLayout(page, { screen, state, layout, browserName, options, known: KNOWN_LAYOUT_FAILURES });
      });
    }
  });
}
