import { describe, expect, it, vi } from "vitest";
import { createWakeLockController } from "./wake-lock";

class FakeSentinel {
  released = false;
  private listeners = new Set<() => void>();

  addEventListener(_type: "release", listener: () => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "release", listener: () => void) {
    this.listeners.delete(listener);
  }

  async release() {
    if (this.released) return;
    this.released = true;
    for (const listener of this.listeners) listener();
  }

  browserRelease() {
    this.released = true;
    for (const listener of this.listeners) listener();
  }
}

class FakeDocument {
  visibilityState: DocumentVisibilityState = "visible";
  private listeners = new Set<() => void>();

  addEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.delete(listener);
  }

  setVisibility(visibilityState: DocumentVisibilityState) {
    this.visibilityState = visibilityState;
    for (const listener of this.listeners) listener();
  }

  listenerCount() {
    return this.listeners.size;
  }
}

function setup() {
  const document = new FakeDocument();
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async () => {
    const sentinel = new FakeSentinel();
    sentinels.push(sentinel);
    return sentinel;
  });
  const controller = createWakeLockController({
    document,
    navigator: { wakeLock: { request } },
  });

  return { controller, document, request, sentinels };
}

describe("wake lock controller", () => {
  it("is SSR-safe and reports an unsupported environment", async () => {
    const controller = createWakeLockController({});

    expect(controller.getSnapshot()).toMatchObject({
      status: "unsupported",
      active: false,
      supported: false,
    });
    await expect(controller.request()).resolves.toBe(false);
    await controller.dispose();
    expect(controller.getSnapshot().status).toBe("disposed");
  });

  it("acquires and explicitly releases a screen wake lock", async () => {
    const { controller, request, sentinels } = setup();

    await expect(controller.request()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith("screen");
    expect(controller.getSnapshot()).toMatchObject({ status: "active", active: true });

    await controller.release();
    expect(sentinels[0].released).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ status: "idle", active: false });
  });

  it("reacquires an automatically released lock when the tab is visible again", async () => {
    const { controller, document, request, sentinels } = setup();

    await controller.request();
    document.setVisibility("hidden");
    sentinels[0].browserRelease();
    expect(controller.getSnapshot().status).toBe("waiting");

    document.setVisibility("visible");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(controller.getSnapshot()).toMatchObject({ status: "active", active: true });
  });

  it("deduplicates concurrent acquisition requests", async () => {
    const { controller, request } = setup();

    const first = controller.request();
    const second = controller.request();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("removes listeners and releases the lock on dispose", async () => {
    const { controller, document, request, sentinels } = setup();

    await controller.request();
    await controller.dispose();
    document.setVisibility("visible");

    expect(sentinels[0].released).toBe(true);
    expect(document.listenerCount()).toBe(0);
    expect(request).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ status: "disposed", active: false });
  });

  it("surfaces acquisition failure as state instead of throwing", async () => {
    const error = new Error("NotAllowedError");
    const controller = createWakeLockController({
      navigator: { wakeLock: { request: vi.fn().mockRejectedValue(error) } },
    });

    await expect(controller.request()).resolves.toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      active: false,
      error,
    });
  });

  it("releases a late acquisition after the walk is disposed", async () => {
    const sentinel = new FakeSentinel();
    let resolveRequest!: (value: FakeSentinel) => void;
    const controller = createWakeLockController({
      navigator: { wakeLock: { request: () => new Promise((resolve) => { resolveRequest = resolve; }) } },
    });
    const request = controller.request();
    const disposal = controller.dispose();
    resolveRequest(sentinel);
    await expect(request).resolves.toBe(false);
    await disposal;
    expect(sentinel.released).toBe(true);
    expect(controller.getSnapshot().status).toBe("disposed");
  });

  it("does not report an active lock acquired after the tab becomes hidden", async () => {
    const document = new FakeDocument();
    const sentinel = new FakeSentinel();
    let resolveRequest!: (value: FakeSentinel) => void;
    const controller = createWakeLockController({
      document,
      navigator: { wakeLock: { request: () => new Promise((resolve) => { resolveRequest = resolve; }) } },
    });
    const request = controller.request();
    document.setVisibility("hidden");
    resolveRequest(sentinel);
    await expect(request).resolves.toBe(false);
    expect(sentinel.released).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ status: "waiting", active: false });
    await controller.dispose();
  });

  it("surfaces release failure without rejecting cleanup", async () => {
    const error = new Error("Release failed");
    const sentinel = {
      released: false,
      release: vi.fn().mockRejectedValue(error),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const controller = createWakeLockController({
      navigator: { wakeLock: { request: vi.fn().mockResolvedValue(sentinel) } },
    });

    await controller.request();
    await expect(controller.release()).resolves.toBeUndefined();
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      active: false,
      error,
    });
  });
});
