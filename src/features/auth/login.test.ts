// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { Login } from "./login";
import { getAuthProviders, getSession, getTelegramAuthorizationUrl, signInWithPassword, signUpWithPassword } from "./client";

vi.mock("../../../legal/publication.mjs", () => ({ LEGAL_READY: true }));

vi.mock("../navigation/app-header", () => ({ AppHeader: () => null }));
vi.mock("./client", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  getAuthProviders: vi.fn(),
  getTelegramAuthorizationUrl: vi.fn(),
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;

async function mount(locale: Locale) {
  await act(async () => root.render(createElement(I18nProvider, { locale } as ComponentProps<typeof I18nProvider>, createElement(Login))));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("location", { origin: "https://otgolosok.online", search: "", replace: vi.fn() });
  vi.mocked(getSession).mockResolvedValue(null);
  vi.mocked(getAuthProviders).mockResolvedValue({ telegram: true });
  vi.mocked(getTelegramAuthorizationUrl).mockResolvedValue("https://oauth.telegram.org/auth?bot_id=1");
  vi.mocked(signInWithPassword).mockResolvedValue({});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ["en", "Sign in", "Password", "No account? Sign up"],
  ["zh", "登录", "密码", "没有账户？注册"],
] as const)("renders the login UI in %s", async (locale, heading, password, switchLabel) => {
  await mount(locale);
  expect(container.querySelector("h1")?.textContent).toBe(heading);
  expect(container.querySelector(".auth-language select[aria-label]")?.getAttribute("aria-label")).toBe(locale === "en" ? "Interface language" : "界面语言");
  expect(container.textContent).toContain(password);
  expect(container.querySelector(".text-button")?.textContent).toBe(switchLabel);
});

it.each([
  ["en", "Incorrect email or password."],
  ["zh", "邮箱或密码不正确。"],
] as const)("shows a failed sign-in in %s without clearing the form", async (locale, message) => {
  vi.mocked(signInWithPassword).mockRejectedValue(new Error("Неверный email или пароль."));
  await mount(locale);
  const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
  const password = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  const setInput = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => { setInput(email, "anna@example.test"); setInput(password, "correct-length"); });
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(signInWithPassword).toHaveBeenCalledWith("anna@example.test", "correct-length");
  expect(container.querySelector("[role=alert]")?.textContent).toBe(message);
  expect(email.value).toBe("anna@example.test");
  expect(password.value).toBe("correct-length");
});

it("offers Telegram in both login modes without replacing the email form", async () => {
  await mount("ru");
  const telegram = () => [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Продолжить через Telegram"));
  expect(telegram()).toBeTruthy();
  expect(container.querySelector('input[type="email"]')).toBeTruthy();
  await act(async () => container.querySelector<HTMLButtonElement>(".text-button")!.click());
  expect(container.querySelector("h1")?.textContent).toBe("Регистрация");
  expect(telegram()).toBeTruthy();
  expect(container.querySelector('input[autocomplete="name"]')).toBeTruthy();
});

it("keeps email login available when Telegram is disabled", async () => {
  vi.mocked(getAuthProviders).mockResolvedValue({ telegram: false });
  await mount("ru");
  expect(container.querySelector(".telegram-button")).toBeNull();
  expect(container.querySelector('input[type="email"]')).toBeTruthy();
  expect(container.querySelector("form .account-button")?.textContent).toBe("Войти");
});

it("explains a provider configuration failure and retries it", async () => {
  vi.mocked(getAuthProviders).mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ telegram: true });
  await mount("ru");
  const providerAlert = container.querySelector(".auth-provider-error");
  expect(providerAlert?.textContent).toContain("Не удалось проверить доступность входа через Telegram.");
  expect(container.querySelector('input[type="email"]')).toBeTruthy();
  await act(async () => providerAlert?.querySelector("button")?.click());
  expect(getAuthProviders).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".telegram-button")?.textContent).toContain("Продолжить через Telegram");
});

it("blocks Telegram on the initial sign-in screen until terms are accepted", async () => {
  await mount("ru");
  const telegram = container.querySelector<HTMLButtonElement>(".telegram-button")!;
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(telegram.disabled).toBe(true);
  expect(checkbox).not.toBeNull();
  expect(checkbox!.checked).toBe(false);
  expect(checkbox!.required).toBe(false);
  expect(container.querySelector<HTMLButtonElement>(".account-button")!.disabled).toBe(false);
  const navigationCount = vi.mocked(location.replace).mock.calls.length;
  const authorizationCount = vi.mocked(getTelegramAuthorizationUrl).mock.calls.length;
  await act(async () => telegram.click());
  expect(vi.mocked(location.replace).mock.calls.length).toBe(navigationCount);
  expect(vi.mocked(getTelegramAuthorizationUrl).mock.calls.length).toBe(authorizationCount);
  await act(async () => checkbox!.click());
  expect(telegram.disabled).toBe(false);
  await act(async () => checkbox!.click());
  expect(telegram.disabled).toBe(true);
});

it("passes a preserved return target to Telegram and navigates only to the checked URL", async () => {
  vi.stubGlobal("location", { origin: "https://otgolosok.online", search: "?returnTo=%2Fwalk%3Fid%3D42", replace: vi.fn() });
  await mount("ru");
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>(".telegram-button")!.click());
  expect(getTelegramAuthorizationUrl).toHaveBeenCalledWith("/walk?id=42", "ru", "https://otgolosok.online", true);
  expect(location.replace).toHaveBeenCalledWith("https://oauth.telegram.org/auth?bot_id=1");
});

it("switching authentication modes clears acceptance before another Telegram attempt", async () => {
  await mount("ru");
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(container.querySelector<HTMLButtonElement>(".telegram-button")!.disabled).toBe(false);
  for (const heading of ["Регистрация", "Вход"]) {
    await act(async () => container.querySelector<HTMLButtonElement>(".text-button")!.click());
    expect(container.querySelector("h1")?.textContent).toBe(heading);
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect(container.querySelector<HTMLButtonElement>(".telegram-button")!.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  }
});

it("registration requires a separate unchecked acceptance for both Telegram and email", async () => {
  await mount("ru");
  await act(async () => container.querySelector<HTMLButtonElement>(".text-button")!.click());
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const telegram = container.querySelector<HTMLButtonElement>(".telegram-button")!;
  const emailButton = container.querySelector<HTMLButtonElement>(".account-button")!;
  expect(checkbox.checked).toBe(false);
  expect(telegram.disabled).toBe(true);
  expect(emailButton.disabled).toBe(true);
  await act(async () => checkbox.click());
  expect(telegram.disabled).toBe(false);
  expect(emailButton.disabled).toBe(false);
  await act(async () => telegram.click());
  expect(getTelegramAuthorizationUrl).toHaveBeenCalledWith(null, "ru", "https://otgolosok.online", true);
  expect(location.replace).toHaveBeenCalledWith("https://oauth.telegram.org/auth?bot_id=1");
});

it("sends explicit acceptance with password registration", async () => {
  vi.mocked(signUpWithPassword).mockResolvedValue({});
  await mount("ru");
  await act(async () => container.querySelector<HTMLButtonElement>(".text-button")!.click());
  await act(async () => {
    for (const [selector, value] of [['input[autocomplete="name"]', "Анна"], ['input[type="email"]', "anna@example.test"], ['input[type="password"]', "correct-length"]]) {
      const input = container.querySelector<HTMLInputElement>(selector)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
  await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
  expect(signUpWithPassword).toHaveBeenCalledWith("Анна", "anna@example.test", "correct-length", true);
  expect(location.replace).toHaveBeenCalledWith("/account");
});

it("a new Telegram user without acceptance gets registration while preserving the return target", async () => {
  vi.stubGlobal("location", { origin: "https://otgolosok.online", search: "?telegram_error=1&error=TERMS_REQUIRED&returnTo=%2Fwalk%3Fid%3D42", replace: vi.fn() });
  await mount("ru");
  expect(container.querySelector("h1")?.textContent).toBe("Регистрация");
  expect(container.querySelector(".form-error")?.textContent).toBe("Для регистрации примите актуальные условия использования.");
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>(".telegram-button")!.click());
  expect(getTelegramAuthorizationUrl).toHaveBeenCalledWith("/walk?id=42", "ru", "https://otgolosok.online", true);
  expect(container.textContent).not.toContain("TERMS_REQUIRED");
});

it.each([
  ["en", "Could not sign in with Telegram. Please try again."],
  ["zh", "无法通过 Telegram 登录。请重试。"],
] as const)("shows a generic Telegram callback error without exposing its code in %s", async (locale, expected) => {
  vi.stubGlobal("location", { origin: "https://otgolosok.online", search: "?telegram_error=1&error=access_denied&returnTo=%2Faccount", replace: vi.fn() });
  vi.mocked(getSession).mockResolvedValue({ id: "user-1", name: "Anna", email: null, authMethod: "telegram" });
  await mount(locale);
  expect(container.querySelector(".form-error")?.textContent).toBe(expected);
  expect(container.textContent).not.toContain("access_denied");
  expect(location.replace).not.toHaveBeenCalled();
});
