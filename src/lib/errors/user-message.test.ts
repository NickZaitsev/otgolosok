import { describe, expect, it } from "vitest";
import { toUserMessage, USER_MESSAGES } from "./user-message";

const fallback = "Не удалось выполнить действие.";

describe("toUserMessage", () => {
  it.each([
    ["сообщение сервера на русском", new Error("Можно сохранить не больше 200 прогулок. Удалите ненужные."), "Можно сохранить не больше 200 прогулок. Удалите ненужные."],
    ["сбой fetch в Chrome", new TypeError("Failed to fetch"), USER_MESSAGES.network],
    ["сбой fetch в Firefox", new TypeError("NetworkError when attempting to fetch resource."), USER_MESSAGES.network],
    ["сбой fetch в Safari", new TypeError("Load failed"), USER_MESSAGES.network],
    ["ошибка программы", new TypeError("x is not a function"), fallback],
    ["таймаут AbortSignal", new DOMException("signal timed out", "TimeoutError"), USER_MESSAGES.timeout],
    ["отмена запроса", new DOMException("The operation was aborted.", "AbortError"), USER_MESSAGES.aborted],
    ["HTML вместо JSON", new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON"), USER_MESSAGES.badResponse],
    ["переполнение хранилища", new DOMException("Quota exceeded", "QuotaExceededError"), USER_MESSAGES.storageFull],
    ["английская ошибка", new Error("Internal Server Error"), fallback],
    ["не ошибка", "boom", fallback],
    ["пусто", null, fallback],
  ])("%s", (_, error, expected) => {
    expect(toUserMessage(error, fallback)).toBe(expected);
  });
});
