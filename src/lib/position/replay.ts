import type { PositionFix } from "../geo/types";
import type { PositionSource, PositionSourceListener } from "./types";

export type ReplayPositionSourceOptions = {
  fixes: readonly PositionFix[];
  intervalMs?: number;
  loop?: boolean;
};

export function createReplayPositionSource({
  fixes,
  intervalMs = 1_000,
  loop = false,
}: ReplayPositionSourceOptions): PositionSource {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError("Replay interval must be a finite, non-negative number.");
  }

  const replayFixes = fixes.map((fix) => ({ ...fix }));

  return {
    kind: "replay",
    subscribe(listener: PositionSourceListener) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let fixIndex = 0;
      let sequence = 0;

      listener({ type: "status", source: "replay", status: "starting" });

      if (replayFixes.length === 0) {
        listener({ type: "status", source: "replay", status: "complete" });
        return () => undefined;
      }

      listener({ type: "status", source: "replay", status: "active" });

      const emitNext = () => {
        if (stopped) return;

        sequence += 1;
        listener({
          type: "fix",
          source: "replay",
          sequence,
          fix: replayFixes[fixIndex],
        });

        const isLastFix = fixIndex === replayFixes.length - 1;
        if (isLastFix && !loop) {
          stopped = true;
          listener({ type: "status", source: "replay", status: "complete" });
          return;
        }

        fixIndex = isLastFix ? 0 : fixIndex + 1;
        timer = setTimeout(emitNext, intervalMs);
      };

      emitNext();

      return () => {
        if (stopped) return;
        stopped = true;
        if (timer !== null) clearTimeout(timer);
        listener({ type: "status", source: "replay", status: "stopped" });
      };
    },
  };
}
