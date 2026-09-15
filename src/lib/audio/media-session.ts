/**
 * Lock-screen and headphone controls for the walk.
 *
 * The walk is meant to be heard with the phone in a pocket, so every control the
 * dark screen offers has to exist outside the page as well. Browsers disagree on
 * which actions they accept and reject invalid position state outright, so every
 * call here is guarded and a missing Media Session degrades to no controls.
 */

export type MediaSessionTrack = {
  title: string;
  artist: string;
  album: string;
  artwork?: Array<{ src: string; sizes: string; type: string }>;
};

export type MediaSessionActions = {
  play?: () => void;
  pause?: () => void;
  seekBy?: (offsetSec: number) => void;
  seekTo?: (positionSec: number) => void;
  next?: () => void;
  previous?: () => void;
};

export type MediaSessionPosition = {
  durationSec: number;
  positionSec: number;
  playbackRate: number;
};

type ActionDetails = { seekOffset?: number; seekTime?: number };

export type MediaSessionLike = {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  setActionHandler: (action: string, handler: ((details: ActionDetails) => void) | null) => void;
  setPositionState?: (state?: { duration: number; playbackRate: number; position: number }) => void;
};

export type MediaSessionEnvironment = {
  session: MediaSessionLike;
  createMetadata: (track: MediaSessionTrack) => unknown;
};

export const DEFAULT_SEEK_OFFSET_SEC = 15;

/** Every action this controller ever registers, so release can clear all of them. */
const ACTIONS = ["play", "pause", "seekbackward", "seekforward", "seekto", "nexttrack", "previoustrack"] as const;

export function readMediaSessionEnvironment(): MediaSessionEnvironment | null {
  if (typeof navigator === "undefined") return null;
  const session = (navigator as Navigator & { mediaSession?: MediaSessionLike }).mediaSession;
  const Metadata = (globalThis as { MediaMetadata?: new (track: MediaSessionTrack) => unknown }).MediaMetadata;
  if (!session || typeof session.setActionHandler !== "function" || typeof Metadata !== "function") return null;
  return { session, createMetadata: (track) => new Metadata(track) };
}

export function createMediaSessionController(environment = readMediaSessionEnvironment()) {
  let released = false;

  // Safari throws NotSupportedError for actions it does not implement, and an
  // unsupported action must not prevent the remaining ones from registering.
  function setHandler(action: string, handler: ((details: ActionDetails) => void) | null) {
    if (!environment || released) return;
    try { environment.session.setActionHandler(action, handler); } catch { /* This platform lacks the action. */ }
  }

  return {
    get available() { return Boolean(environment); },

    setActions(actions: MediaSessionActions) {
      if (!environment || released) return;
      const offset = (details: ActionDetails) =>
        Number.isFinite(details?.seekOffset) && details.seekOffset! > 0 ? details.seekOffset! : DEFAULT_SEEK_OFFSET_SEC;
      setHandler("play", actions.play ? () => actions.play!() : null);
      setHandler("pause", actions.pause ? () => actions.pause!() : null);
      setHandler("seekbackward", actions.seekBy ? (details) => actions.seekBy!(-offset(details)) : null);
      setHandler("seekforward", actions.seekBy ? (details) => actions.seekBy!(offset(details)) : null);
      setHandler("seekto", actions.seekTo
        ? (details) => { if (Number.isFinite(details?.seekTime)) actions.seekTo!(details.seekTime!); }
        : null);
      // A cleared handler greys the button out instead of leaving a dead control.
      setHandler("nexttrack", actions.next ? () => actions.next!() : null);
      setHandler("previoustrack", actions.previous ? () => actions.previous!() : null);
    },

    setTrack(track: MediaSessionTrack | null) {
      if (!environment || released) return;
      try {
        environment.session.metadata = track ? environment.createMetadata(track) : null;
      } catch { /* Metadata is decoration; playback continues without it. */ }
    },

    setPlaybackState(state: "none" | "paused" | "playing") {
      if (!environment || released) return;
      try { environment.session.playbackState = state; } catch { /* Read-only in some engines. */ }
    },

    /** Chrome throws TypeError on position state it considers inconsistent. */
    setPosition(position: MediaSessionPosition | null) {
      if (!environment || released || typeof environment.session.setPositionState !== "function") return;
      try {
        if (!position) { environment.session.setPositionState(); return; }
        const { durationSec, positionSec, playbackRate } = position;
        if (!Number.isFinite(durationSec) || durationSec <= 0) { environment.session.setPositionState(); return; }
        const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
        environment.session.setPositionState({
          duration: durationSec,
          playbackRate: rate,
          position: Math.min(Math.max(positionSec, 0), durationSec),
        });
      } catch { /* Leave the previous state rather than failing playback. */ }
    },

    release() {
      if (!environment || released) return;
      for (const action of ACTIONS) setHandler(action, null);
      try { environment.session.metadata = null; } catch { /* Already gone. */ }
      try { environment.session.playbackState = "none"; } catch { /* Read-only in some engines. */ }
      try { environment.session.setPositionState?.(); } catch { /* Nothing to clear. */ }
      released = true;
    },
  };
}

export type MediaSessionController = ReturnType<typeof createMediaSessionController>;
