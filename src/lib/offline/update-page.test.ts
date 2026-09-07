import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const script = readFileSync(new URL("../../../public/update.js", import.meta.url), "utf8");

function setup(register: () => Promise<unknown>) {
  const status = { textContent: "" };
  const button = { hidden: true, addEventListener: vi.fn() };
  const replace = vi.fn();
  const serviceWorker = Object.assign(new EventTarget(), { register, controller: null as unknown });
  runInNewContext(script, {
    document: { getElementById: (id: string) => id === "update-status" ? status : button },
    navigator: { serviceWorker },
    window: { location: { replace } },
    setTimeout, clearTimeout, AbortController,
  });
  return { status, button, replace, serviceWorker };
}

afterEach(() => vi.useRealTimers());

describe("standalone update recovery", () => {
  it("offers retry after a network failure without leaving the page", async () => {
    vi.useFakeTimers();
    const { status, button, replace } = setup(() => Promise.reject(new Error("Offline")));
    await vi.advanceTimersByTimeAsync(0);
    expect(status.textContent).toContain("Проверьте интернет");
    expect(button.hidden).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a hung browser update at 25 seconds", async () => {
    vi.useFakeTimers();
    const { button, replace } = setup(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(24999);
    expect(button.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(button.hidden).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it("waits for activation and ownership before opening the new story", async () => {
    vi.useFakeTimers();
    const worker = Object.assign(new EventTarget(), { state: "installed", postMessage: vi.fn() });
    const registration = { update: vi.fn().mockResolvedValue(undefined), waiting: worker, installing: null };
    const { serviceWorker, replace } = setup(async () => registration);
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "ACTIVATE_UPDATE" });
    expect(replace).not.toHaveBeenCalled();
    worker.state = "activated";
    worker.dispatchEvent(new Event("statechange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(replace).not.toHaveBeenCalled();
    serviceWorker.controller = worker;
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(replace).toHaveBeenCalledExactlyOnceWith("/#top");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not activate an older waiting worker when the new install fails", async () => {
    vi.useFakeTimers();
    const oldWaiting = { postMessage: vi.fn() };
    const installing = Object.assign(new EventTarget(), { state: "redundant" });
    const { button, replace } = setup(async () => ({
      update: vi.fn().mockResolvedValue(undefined), installing, waiting: oldWaiting,
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(oldWaiting.postMessage).not.toHaveBeenCalled();
    expect(button.hidden).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
