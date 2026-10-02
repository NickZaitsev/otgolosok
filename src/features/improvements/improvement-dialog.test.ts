// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IMPROVEMENT_SENT_CLOSE_MS, ImprovementDialog } from "./improvement-dialog";
import type { MyImprovement } from "./model";

vi.mock("../auth/client", () => ({ getSession: vi.fn().mockResolvedValue(null), csrfHeaders: () => ({}) }));

let root: Root, container: HTMLDivElement;
const fetchMock = vi.fn();
const target = { kind: "catalog", id: "arbat" } as const;
const PATH = "/api/story-walks/arbat/improvements/mine";
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const stored = (issues: MyImprovement["issues"], status: MyImprovement["status"] = "open") => ({ mine: { issues, status, updatedAt: "2026-10-02T10:00:00Z" } });

async function mount(open = true) {
  const onClose = vi.fn();
  await act(async () => root.render(createElement(ImprovementDialog, { target: { ...target }, open, onClose, walkTitle: "Арбат" })));
  // Let the reviewer check and the stored request load.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return onClose;
}
const checkbox = (label: string) => [...container.querySelectorAll("label")].find(item => item.textContent === label)!.querySelector("input")!;
const submit = () => container.querySelector<HTMLButtonElement>("button[type='submit']")!;
async function tick(label: string) { await act(async () => checkbox(label).click()); }
async function send() { await act(async () => submit().click()); }
const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([url, init]) => [url, JSON.parse(init.body)]);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("offers the three options and sends the ticked ones with the guest key", async () => {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "PUT" ? respond(stored(["short_text", "voiceover"])) : respond({ mine: null }));
  await mount();
  expect([...container.querySelectorAll("label")].map(label => label.textContent)).toEqual([
    "Мало информации: тексты слишком короткие", "Нет превью изображений", "Не нравится озвучка",
  ]);
  expect(submit().disabled, "nothing ticked, nothing to send").toBe(true);
  await tick("Не нравится озвучка");
  await tick("Мало информации: тексты слишком короткие");
  await send();
  expect(puts()).toEqual([[PATH, { issues: ["short_text", "voiceover"] }]]);
  const headers = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")![1].headers;
  expect(headers["X-Review-Key"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(container.querySelector("[role='status']")?.textContent).toBe("Спасибо! Передали редакции — постараемся улучшить прогулку.");
});

it("closes by itself after the thank-you message", async () => {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "PUT" ? respond(stored(["no_images"])) : respond({ mine: null }));
  const onClose = await mount();
  vi.useFakeTimers();
  await tick("Нет превью изображений");
  await send();
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(IMPROVEMENT_SENT_CLOSE_MS));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("shows a stored request, blocks an unchanged resend and withdraws when everything is unticked", async () => {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "PUT" ? respond({ mine: null }) : respond(stored(["voiceover"])));
  await mount();
  expect(checkbox("Не нравится озвучка").checked).toBe(true);
  expect(submit().disabled).toBe(true);
  expect(submit().textContent).toBe("Сохранить изменения");
  await tick("Не нравится озвучка");
  expect(submit().textContent).toBe("Отозвать запрос");
  await send();
  expect(puts()).toEqual([[PATH, { issues: [] }]]);
  expect(container.querySelector("[role='status']")?.textContent).toBe("Запрос отозван.");
});

it("lets a walker resend a resolved request when the problem remains", async () => {
  fetchMock.mockImplementation(async () => respond(stored(["voiceover"], "resolved")));
  await mount();
  expect(container.textContent).toContain("Редакция уже поработала над вашим прошлым запросом");
  expect(submit().disabled).toBe(false);
  expect(submit().textContent).toBe("Отправить");
});

it("keeps the selection and explains a failed send", async () => {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "PUT"
    ? respond({ error: { code: "REVIEW_KEY_REQUIRED", message: "Не удалось определить автора запроса. Обновите страницу." } }, 400)
    : respond({ mine: null }));
  await mount();
  await tick("Нет превью изображений");
  await send();
  expect(container.querySelector("[role='alert']")?.textContent).toBe("Не удалось определить автора запроса. Обновите страницу.");
  expect(checkbox("Нет превью изображений").checked).toBe(true);
  expect(submit().textContent).toBe("Повторить");
});

it("offers a retry when the form cannot load, and loads nothing while closed", async () => {
  await mount(false);
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(respond({ mine: { issues: ["loud"] } }));
  await mount();
  expect(container.textContent).toContain("Не удалось загрузить форму.");
  fetchMock.mockResolvedValue(respond({ mine: null }));
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Повторить")!.click());
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(container.querySelectorAll("input[type='checkbox']")).toHaveLength(3);
});
