export type WakeLockStatus =
  | "unsupported"
  | "idle"
  | "waiting"
  | "requesting"
  | "active"
  | "error"
  | "disposed";

export interface WakeLockSnapshot {
  status: WakeLockStatus;
  active: boolean;
  supported: boolean;
  error: unknown | null;
}

interface WakeLockSentinelLike {
  readonly released?: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
}

interface WakeLockNavigatorLike {
  wakeLock?: {
    request(type: "screen"): Promise<WakeLockSentinelLike>;
  };
}

interface VisibilityDocumentLike {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface WakeLockControllerOptions {
  navigator?: WakeLockNavigatorLike;
  document?: VisibilityDocumentLike;
  onChange?: (snapshot: WakeLockSnapshot) => void;
}

export interface WakeLockController {
  getSnapshot(): WakeLockSnapshot;
  request(): Promise<boolean>;
  release(): Promise<void>;
  dispose(): Promise<void>;
}

function browserNavigator(): WakeLockNavigatorLike | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : (navigator as unknown as WakeLockNavigatorLike);
}

function browserDocument(): VisibilityDocumentLike | undefined {
  return typeof document === "undefined"
    ? undefined
    : (document as unknown as VisibilityDocumentLike);
}

/**
 * Owns a screen wake lock for the lifetime of one active walk. The controller
 * remembers intent across automatic browser releases and reacquires the lock
 * when the document becomes visible again.
 */
export function createWakeLockController(
  options: WakeLockControllerOptions = {},
): WakeLockController {
  const navigatorLike = options.navigator ?? browserNavigator();
  const documentLike = options.document ?? browserDocument();
  const supported = typeof navigatorLike?.wakeLock?.request === "function";
  let snapshot: WakeLockSnapshot = {
    status: supported ? "idle" : "unsupported",
    active: false,
    supported,
    error: null,
  };
  let desired = false;
  let disposed = false;
  let sentinel: WakeLockSentinelLike | null = null;
  let pendingRequest: Promise<boolean> | null = null;
  const isHidden = () => documentLike?.visibilityState === "hidden";

  const update = (next: Partial<WakeLockSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    options.onChange?.({ ...snapshot });
  };

  const handleSentinelRelease = () => {
    if (!sentinel) return;
    sentinel.removeEventListener("release", handleSentinelRelease);
    sentinel = null;

    if (disposed) {
      update({ status: "disposed", active: false });
    } else if (desired) {
      update({ status: "waiting", active: false });
    } else {
      update({ status: "idle", active: false });
    }
  };

  const acquire = async (): Promise<boolean> => {
    if (disposed || !desired || !supported || !navigatorLike?.wakeLock) {
      return false;
    }

    if (sentinel && sentinel.released !== true) return true;
    if (isHidden()) {
      update({ status: "waiting", active: false, error: null });
      return false;
    }

    update({ status: "requesting", active: false, error: null });

    try {
      const acquired = await navigatorLike.wakeLock.request("screen");

      if (disposed || !desired || isHidden() || acquired.released) {
        await acquired.release();
        if (!disposed && desired) update({ status: "waiting", active: false });
        return false;
      }

      sentinel = acquired;
      sentinel.addEventListener("release", handleSentinelRelease);
      update({ status: "active", active: true, error: null });
      return true;
    } catch (error) {
      if (!disposed && desired) update({ status: "error", active: false, error });
      return false;
    }
  };

  const handleVisibilityChange = () => {
    if (
      desired &&
      !disposed &&
      documentLike?.visibilityState === "visible" &&
      !sentinel
    ) {
      void request();
    }
  };

  documentLike?.addEventListener("visibilitychange", handleVisibilityChange);

  const request = (): Promise<boolean> => {
    if (disposed || !supported) return Promise.resolve(false);
    desired = true;

    if (pendingRequest) return pendingRequest;

    pendingRequest = acquire().finally(() => {
      pendingRequest = null;
    });
    return pendingRequest;
  };

  const release = async () => {
    desired = false;

    if (pendingRequest) await pendingRequest;

    const current = sentinel;
    sentinel = null;
    if (current) {
      current.removeEventListener("release", handleSentinelRelease);
      try {
        await current.release();
      } catch (error) {
        if (!disposed) {
          update({ status: "error", active: false, error });
        }
        return;
      }
    }

    if (!disposed) {
      update({
        status: supported ? "idle" : "unsupported",
        active: false,
        error: null,
      });
    }
  };

  const dispose = async () => {
    if (disposed) return;

    disposed = true;
    desired = false;
    documentLike?.removeEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    if (pendingRequest) await pendingRequest;

    const current = sentinel;
    sentinel = null;
    if (current) {
      current.removeEventListener("release", handleSentinelRelease);
      try {
        await current.release();
      } catch {
        // Disposal is terminal. Browser release failures must not leak cleanup
        // errors into React unmount or prevent the final disposed snapshot.
      }
    }

    update({ status: "disposed", active: false, error: null });
  };

  return {
    getSnapshot: () => ({ ...snapshot }),
    request,
    release,
    dispose,
  };
}
