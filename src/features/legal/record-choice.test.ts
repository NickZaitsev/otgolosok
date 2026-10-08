// @vitest-environment jsdom
import {beforeEach, afterEach, expect, it, vi} from "vitest";
const receipt = "11111111-1111-4111-8111-111111111111." + "a".repeat(43);
beforeEach(() => {vi.resetModules(); localStorage.clear();});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

it("включает аналитику только после успешной серверной записи", async () => {
  let respond!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => {respond = resolve;})));
  const {recordCookieChoice} = await import("./record-choice");
  const {cookieChoice} = await import("./cookie-consent");
  const pending = recordCookieChoice(true);
  expect(cookieChoice()).toBeNull();
  respond(Response.json({receipt, decidedAt: Date.now()}));
  await pending;
  expect(cookieChoice()).toBe("accepted");
});

it("ошибка 4xx не включает аналитику и не повторяет запрос", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("", {status: 403}));
  vi.stubGlobal("fetch", fetcher);
  const {recordCookieChoice} = await import("./record-choice");
  const {cookieChoice} = await import("./cookie-consent");
  await expect(recordCookieChoice(true)).rejects.toThrow();
  expect(cookieChoice()).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("отзыв действует локально даже при отказе сервера", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", {status: 403})));
  const {saveCookieChoice, cookieChoice} = await import("./cookie-consent");
  saveCookieChoice(true, receipt);
  const {recordCookieChoice} = await import("./record-choice");
  const pending = recordCookieChoice(false);
  expect(cookieChoice()).toBe("rejected");
  await expect(pending).rejects.toThrow();
  expect(cookieChoice()).toBe("rejected");
});

it("повторяет временный отказ и записывает полученное подтверждение", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("", {status: 503})).mockResolvedValue(Response.json({receipt, decidedAt: Date.now()}));
  vi.stubGlobal("fetch", fetcher);
  const {recordCookieChoice} = await import("./record-choice");
  const {cookieChoice} = await import("./cookie-consent");
  await recordCookieChoice(true);
  expect(cookieChoice()).toBe("accepted");
  expect(fetcher).toHaveBeenCalledTimes(2);
});


it("отказ другой вкладки имеет приоритет над незавершённым включением", async () => {
  let respond!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => {respond = resolve;})).mockResolvedValue(Response.json({receipt: null}));
  vi.stubGlobal("fetch", fetcher);
  const {recordCookieChoice} = await import("./record-choice");
  const {cookieChoice, saveCookieChoice} = await import("./cookie-consent");
  const pending = recordCookieChoice(true);
  saveCookieChoice(false);
  respond(Response.json({receipt, decidedAt: Date.now()}));
  await expect(pending).rejects.toThrow("другой вкладке");
  expect(cookieChoice()).toBe("rejected");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(expect.objectContaining({analytics: false, receipt}));
});
