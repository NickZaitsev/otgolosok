import { describe, expect, it, vi } from "vitest";
import { createWakeLockController } from "../wake-lock";
import { keepAwakeNavigator, type KeepAwakePlugin } from "./keep-awake";

function setup(overrides: Partial<KeepAwakePlugin> = {}) {
  const plugin = {
    keepAwake: vi.fn(async () => {}),
    allowSleep: vi.fn(async () => {}),
    ...overrides,
  };
  const controller = createWakeLockController({
    navigator: keepAwakeNavigator(async () => plugin),
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  });
  return { plugin, controller };
}

describe("keepAwakeNavigator with the wake lock controller", () => {
  it("keeps the screen on for the walk and lets it sleep after", async () => {
    const { plugin, controller } = setup();

    expect(await controller.request()).toBe(true);
    expect(plugin.keepAwake).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ status: "active", active: true });

    await controller.release();
    expect(plugin.allowSleep).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ status: "idle", active: false });
  });

  it("lets the screen sleep when the walk screen goes away", async () => {
    const { plugin, controller } = setup();
    await controller.request();

    await controller.dispose();

    expect(plugin.allowSleep).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().status).toBe("disposed");
  });

  it("reports a plugin failure as an error instead of an active lock", async () => {
    const failure = new Error("no activity");
    const { controller } = setup({ keepAwake: vi.fn(async () => { throw failure; }) });

    expect(await controller.request()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ status: "error", active: false, error: failure });
  });
});
