import { test, expect } from "./support/test";
import type { ContentDraft, ContentPlace } from "../src/features/admin/model";

test("утверждение и переисследование сохраняют остальные строки черновиков", async ({ page }) => {
  const drafts: ContentDraft[] = Array.from({ length: 3 }, (_, index) => ({
    placeId: `osm:node:${index + 1}`, name: `Место ${index + 1}`, address: null, location: { lat: 55.75, lon: 37.61 }, research: "plain", researchEligible: true,
    text: { id: `text-${index + 1}`, title: `Заголовок ${index + 1}`, paragraphs: ["Текст черновика."], verification: "automatic", createdAt: "2026-10-02T10:00:00Z" },
  }));
  let failApproval = true;
  let holdRefresh = false;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
  let listRequests = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session") {
      await route.fulfill({ json: { user: { id: "editor", role: "editor", name: "Редактор", email: "editor@example.test" }, csrfToken: "test-csrf" } });
    } else if (url.pathname === "/api/story-admin/jobs") {
      await route.fulfill({ json: { jobs: [], hasMore: false } });
    } else if (url.pathname === "/api/story-admin/content/drafts") {
      listRequests++;
      if (holdRefresh) await refreshGate;
      const research = url.searchParams.get("research");
      const items = research === "all" ? drafts : drafts.filter(item => item.research === research);
      await route.fulfill({ json: { items, total: items.length, hasMore: false, researchAvailable: true, deepResearchAvailable: true, unresearched: drafts.length, counts: { plain: drafts.filter(item => item.research === "plain").length, queued: drafts.filter(item => item.research === "queued").length } } });
    } else if (url.pathname === "/api/story-admin/content/drafts/research") {
      const { placeIds } = route.request().postDataJSON() as { placeIds: string[] };
      for (const item of drafts) if (placeIds.includes(item.placeId)) item.research = "queued";
      holdRefresh = true;
      await route.fulfill({ json: { count: placeIds.length, batch: { id: "batch", name: "Исследование" } } });
    } else if (url.pathname.endsWith("/approve")) {
      if (failApproval) { await route.fulfill({ status: 500, json: {} }); return; }
      const id = url.pathname.split("/").at(-2);
      drafts.splice(drafts.findIndex(item => item.placeId === id), 1);
      await route.fulfill({ json: {} });
    } else if (url.pathname.startsWith("/api/story-admin/content/places/")) {
      const item = drafts.find(item => item.placeId === url.pathname.split("/").at(-1))!;
      const story = { title: item.text.title, paragraphs: [{ text: item.text.paragraphs[0], factIds: [] }] };
      const place: ContentPlace = { id: item.placeId, name: item.name, address: item.address, location: item.location, text: { id: item.text.id, profile: "default", story, draft: story, verification: "automatic", audio: null, createdAt: item.text.createdAt } };
      await route.fulfill({ json: { place } });
    } else { await route.fulfill({ json: {} }); }
  });
  await page.goto("/admin?section=drafts");
  await expect(page.getByRole("button", { name: "Открыть черновик: Место 1", exact: true })).toBeEnabled();
  // A marker on an untouched row detects even a brief unmount followed by reconstruction.
  await page.getByRole("row", { name: /Место 3/ }).evaluate(row => { row.setAttribute("data-preserved", "true"); });
  await page.getByRole("button", { name: "Открыть черновик: Место 1", exact: true }).click();
  await page.locator("#content-title").fill("Правки редактора");
  await page.getByRole("button", { name: "Утвердить текст", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ошибка сервера" })).toContainText("Ошибка сервера (500)");
  await expect(page.locator("#content-title")).toHaveValue("Правки редактора");
  failApproval = false;
  await page.getByRole("button", { name: "Утвердить текст", exact: true }).click();
  await expect(page.getByRole("button", { name: "Открыть черновик: Место 1", exact: true })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Место 3/ })).toHaveAttribute("data-preserved", "true");
  expect(listRequests).toBe(1);
  await page.getByRole("button", { name: "Переисследовать черновик: Место 2", exact: true }).click();
  await expect(page.getByText("Черновик «Место 2» поставлен в очередь на переисследование.")).toBeVisible();
  try {
    await expect(page.locator(".admin-skeleton-row")).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Место 3/ })).toHaveAttribute("data-preserved", "true");
  } finally { releaseRefresh(); }
  await expect(page.getByRole("row", { name: /Место 2/ })).toContainText("В очереди на переисследование");
  await expect(page.getByRole("row", { name: /Место 3/ })).toHaveAttribute("data-preserved", "true");
  await page.getByLabel("Статус исследования").selectOption("plain");
  await expect(page.getByRole("button", { name: "Открыть черновик: Место 2", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
