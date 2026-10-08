// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { Login } from "./login";
import { getSession, signInWithPassword, signUpWithPassword } from "./client";

vi.mock("../../../legal/publication.mjs", () => ({ LEGAL_READY: true }));

vi.mock("../navigation/app-header", () => ({ AppHeader: () => null }));
vi.mock("./client", () => ({
  getSession: vi.fn().mockResolvedValue(null),
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
  vi.mocked(getSession).mockResolvedValue(null);
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


it("регистрация требует отдельного неотмеченного подтверждения условий", async () => {
  await mount("ru");
  await act(async () => container.querySelector<HTMLButtonElement>(".text-button")!.click());
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const submit = container.querySelector<HTMLButtonElement>('button[type="submit"], .account-button')!;
  expect(checkbox.checked).toBe(false);
  expect(submit.disabled).toBe(true);
  expect(container.querySelector<HTMLAnchorElement>('a[href="/legal/terms"]')?.target).toBe("_blank");
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})));
  expect(signUpWithPassword).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("примите актуальные условия");
  await act(async () => checkbox.click());
  expect(submit.disabled).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>(".text-button")!.click());
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  expect(submit.disabled).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>(".text-button")!.click());
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
});
