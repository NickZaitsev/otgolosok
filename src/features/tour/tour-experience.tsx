"use client";

import { useEffect, useRef, useState } from "react";
import {
  pauseAudioElement,
  playAudioSource,
  playTestTone,
  resumeAudioElement,
  seekAudioElement,
  stopAudioElement,
  unlockAudioElement,
} from "@/lib/audio";
import { createTriggerState, processFix } from "@/lib/geo/trigger";
import type {
  PositionFix,
  TriggerConfig,
  TriggerState,
} from "@/lib/geo/types";
import {
  CLEAN_REPLAY_TRACK,
  createBrowserPositionSource,
  createReplayPositionSource,
} from "@/lib/position";
import type {
  PositionSourceKind,
  PositionSourceStatus,
  StopPositionSource,
} from "@/lib/position";
import {
  createWakeLockController,
  type WakeLockController,
  type WakeLockStatus,
} from "@/lib/wake-lock";
import type { Route } from "./types";
import { StorySources, StoryText } from "./story-content";
import { RouteNotes } from "./route-notes";
import { AroundScreen } from "../explore/around-screen";
import { RouteMap } from "./route-map";
import { getWalkChapters, WalkPlanPreview } from "./walk-plan";
import { AudioPlayerControls } from "./audio-player-controls";
import { loadPublishedRoute } from "./published-route-cache";
import { usePlaybackProgress } from "./use-playback-progress";
import { formatPlaybackTime, type PlaybackCheckpoint } from "@/lib/audio/playback-progress";

type SessionPhase = "reading" | "walking";
type AudioStatus = "locked" | "unlocking" | "ready" | "loading" | "playing" | "paused" | "ended" | "blocked" | "error";

type Diagnostics = {
  source: PositionSourceKind | null;
  sourceStatus: PositionSourceStatus | "idle";
  lastFix: PositionFix | null;
  distanceM: number | null;
  trigger: TriggerState;
  sourceError: string | null;
};

const initialDiagnostics: Diagnostics = {
  source: null,
  sourceStatus: "idle",
  lastFix: null,
  distanceM: null,
  trigger: createTriggerState(),
  sourceError: null,
};

const sourceLabels: Record<PositionSourceStatus | "idle", string> = {
  idle: "ожидает",
  starting: "запрашиваем",
  active: "работает",
  stopped: "остановлен",
  complete: "трек завершён",
  "permission-denied": "доступ не дан",
  unavailable: "недоступна",
  error: "ошибка",
};

const wakeLabels: Record<WakeLockStatus, string> = {
  unsupported: "не поддерживается",
  idle: "ожидает",
  waiting: "ждёт активную вкладку",
  requesting: "запрашиваем",
  active: "экран активен",
  error: "не удалось включить",
  disposed: "выключен",
};

const audioLabels: Record<AudioStatus, string> = {
  locked: "не активирован",
  unlocking: "подготовка",
  ready: "готов",
  loading: "запускается",
  playing: "воспроизведение",
  paused: "пауза",
  ended: "запись закончилась",
  blocked: "нужно нажатие",
  error: "ошибка воспроизведения",
};

export function TourExperience({ route }: { route: Route }) {
  const firstPoi = route.pois[0];
  if (!firstPoi) {
    return <main className="shell"><section className="hero-copy">
      <h1>{route.title}</h1>
      <p className="dek">Маршрут готовится. Точки прогулки появятся здесь позже.</p>
    </section></main>;
  }
  return <AvailableTour route={route} />;
}

function AvailableTour({ route: initialRoute }: { route: Route }) {
  const [route, setRoute] = useState(initialRoute);
  const firstPoi = route.pois[0];
  const [phase, setPhase] = useState<SessionPhase>("reading");
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("locked");
  const [wakeStatus, setWakeStatus] = useState<WakeLockStatus>("idle");
  const [diagnostics, setDiagnostics] =
    useState<Diagnostics>(initialDiagnostics);
  const [showSources, setShowSources] = useState(false);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [isReplay, setIsReplay] = useState(false);
  const [offlineStatus, setOfflineStatus] = useState("Офлайн-копия ещё не сохранена");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const walkTitleRef = useRef<HTMLHeadingElement>(null);
  const sessionActiveRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const wakeControllerRef = useRef<WakeLockController | null>(null);
  const stopSourceRef = useRef<StopPositionSource | null>(null);
  const triggerStateRef = useRef<TriggerState>(createTriggerState());
  const audioBusyRef = useRef(false);
  const sessionRef = useRef(0);
  const playbackRef = useRef(0);
  const activeCheckpointRef = useRef<PlaybackCheckpoint | null>(null);
  const playbackSourceRef = useRef<string | null>(null);
  const restoringOffsetRef = useRef(false);
  const lastSavedTimeRef = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    void loadPublishedRoute(initialRoute, controller.signal)
      .then(value => {
        // A listening session keeps its exact text, audio and resume offsets.
        if (!controller.signal.aborted) setRoute(current => sessionActiveRef.current ? current : value);
      })
      .catch(() => { /* The bundled walk remains available offline. */ })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [initialRoute]);
  const usesTestAudio = !firstPoi.story.audio_url;
  const hasStoryText = firstPoi.story.text_status === "ready" && firstPoi.story.paragraphs.length > 0;
  const storyMinutes = Math.ceil(firstPoi.story.duration_sec / 60);
  const readyNotes = (route.notes ?? []).filter((note) => note.story.text_status === "ready" && note.story.paragraphs.length > 0);
  const chapters = getWalkChapters(route);
  const chapter = chapters[chapterIndex];
  const walkContent = chapter?.content ?? firstPoi;
  const walkAudioUrl = chapter?.audio?.url ?? walkContent.story.audio_url;
  const walkUsesTestAudio = !walkAudioUrl;
  const hasWalkAudio = chapters.length > 0 && chapters.every((item) => item.audio?.url);
  const { savedCheckpoint, saveCheckpoint, clearCheckpoint } = usePlaybackProgress(route.id,
    chapters.flatMap((item) => item.audio ? [{ id: item.id, audioUrl: item.audio.url, durationSec: item.audio.duration_sec }] : []));
  const savedChapterIndex = savedCheckpoint ? chapters.findIndex((item) => item.id === savedCheckpoint.chapterId) : -1;
  const target = route.walk?.finish.location ?? firstPoi.viewpoint ?? firstPoi.location;
  const triggerConfig: TriggerConfig = {
    enterM: firstPoi.trigger.enter_m,
    exitM: firstPoi.trigger.exit_m,
    minFixes: firstPoi.trigger.min_fixes,
    windowSize: 5,
    maxAccuracyM: firstPoi.trigger.max_accuracy_m,
  };

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;
    const cleanups: Array<() => void> = [];
    void navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).then(async (registration) => {
      if (cancelled) return;
      const checkUpdate = () => {
        if (!cancelled) setUpdateAvailable(Boolean(registration.waiting));
      };
      const watchInstalling = () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", checkUpdate);
        cleanups.push(() => worker.removeEventListener("statechange", checkUpdate));
      };
      const checkOnReturn = () => {
        if (document.visibilityState === "visible") void registration.update().catch(() => {});
      };
      registration.addEventListener("updatefound", watchInstalling);
      document.addEventListener("visibilitychange", checkOnReturn);
      window.addEventListener("online", checkOnReturn);
      cleanups.push(() => {
        registration.removeEventListener("updatefound", watchInstalling);
        document.removeEventListener("visibilitychange", checkOnReturn);
        window.removeEventListener("online", checkOnReturn);
      });
      watchInstalling();
      checkUpdate();
      if (!registration.active) {
        const worker = registration.installing ?? registration.waiting;
        if (!worker) throw new Error("Service Worker did not start");
        await new Promise<void>((resolve, reject) => {
          const check = () => {
            if (worker.state === "activated" || worker.state === "redundant") {
              worker.removeEventListener("statechange", check);
              if (worker.state === "activated") resolve();
              else reject(new Error("Offline installation failed"));
            }
          };
          worker.addEventListener("statechange", check);
          check();
        });
      }
      if (!cancelled) setOfflineStatus("Офлайн-копия готова");
    }).catch(() => {
      if (!cancelled) setOfflineStatus("Не удалось сохранить офлайн-копию · нужен интернет");
    });
    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    const audioElement = audioRef.current;

    return () => {
      sessionRef.current += 1;
      sessionActiveRef.current = false;
      stopSourceRef.current?.();
      stopSourceRef.current = null;
      if (audioElement) stopAudioElement(audioElement);
      void wakeControllerRef.current?.dispose();
      wakeControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== "reading") walkTitleRef.current?.focus();
    if (phase === "reading" && restoreFocusRef.current) {
      (startButtonRef.current ?? document.getElementById("around-title"))?.focus();
      restoreFocusRef.current = false;
    }
  }, [phase, chapterIndex]);

  useEffect(() => {
    const persist = () => {
      if (activeCheckpointRef.current) saveCheckpoint(activeCheckpointRef.current);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      persist();
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [saveCheckpoint]);

  function syncPlaybackProgress(persist = false) {
    const audio = audioRef.current;
    if (!audio || !sessionActiveRef.current || restoringOffsetRef.current) return;
    if (playbackSourceRef.current && audio.getAttribute("src") !== playbackSourceRef.current) return;
    if (audio.readyState < 1 || !Number.isFinite(audio.currentTime)) return;
    setPlaybackTime(audio.currentTime);
    if (Number.isFinite(audio.duration)) setMediaDuration(audio.duration);
    const checkpoint = activeCheckpointRef.current;
    if (!checkpoint) return;
    activeCheckpointRef.current = { ...checkpoint, positionSec: audio.currentTime };
    if (persist || Math.abs(audio.currentTime - lastSavedTimeRef.current) >= 2) {
      saveCheckpoint(activeCheckpointRef.current);
      lastSavedTimeRef.current = audio.currentTime;
    }
  }

  function setChapterCheckpoint(index: number, positionSec = 0) {
    const item = chapters[index];
    activeCheckpointRef.current = item?.audio ? {
      version: 1, routeId: route.id, chapterId: item.id,
      audioUrl: item.audio.url, positionSec,
    } : null;
    lastSavedTimeRef.current = positionSec;
    if (activeCheckpointRef.current) saveCheckpoint(activeCheckpointRef.current);
  }

  function finishAudio() {
    if (!sessionActiveRef.current) return;
    audioBusyRef.current = false;
    syncPlaybackProgress(true);
    if (audioRef.current?.ended) setAudioStatus("ended");
    else setAudioStatus((current) => current === "playing" ? "paused" : current);
  }

  async function playSignal(source: string | null = walkAudioUrl, positionSec = 0, resume = false) {
    const audio = audioRef.current;
    if (!audio || !sessionActiveRef.current) return;

    const session = sessionRef.current;
    const playback = playbackRef.current + 1;
    playbackRef.current = playback;
    audioBusyRef.current = true;
    const reuse = resume && source && !audio.error && audio.readyState >= 1 &&
      audio.getAttribute("src") === source && Math.abs(audio.currentTime - positionSec) < 0.5;
    playbackSourceRef.current = source;
    restoringOffsetRef.current = !reuse && positionSec > 0;
    setPlaybackTime(positionSec);
    if (!reuse) setMediaDuration(0);
    setAudioStatus("loading");
    const didPlay = reuse ? await resumeAudioElement(audio) : source
      ? await playAudioSource(audio, source, positionSec)
      : await playTestTone(audio);
    if (sessionRef.current !== session || playbackRef.current !== playback) return;
    if (!didPlay) {
      audioBusyRef.current = false;
      setAudioStatus(audio.error ? "error" : "blocked");
    } else {
      restoringOffsetRef.current = false;
      syncPlaybackProgress(true);
      audioBusyRef.current = !audio.paused && !audio.ended;
      setAudioStatus(audio.ended ? "ended" : audio.paused ? "paused" : "playing");
    }
  }

  function toggleAudio() {
    if (phase !== "walking") return;
    if ((audioStatus === "playing" || audioStatus === "loading") && audioRef.current) {
      playbackRef.current += 1;
      syncPlaybackProgress(true);
      pauseAudioElement(audioRef.current);
      audioBusyRef.current = false;
      setAudioStatus("paused");
      return;
    }
    const position = audioStatus === "ended" ? 0 : activeCheckpointRef.current?.positionSec ?? playbackTime;
    void playSignal(walkAudioUrl, position, audioStatus === "paused");
  }

  function seekPlayback(position: number) {
    const audio = audioRef.current;
    if (!audio || !sessionActiveRef.current || audioStatus === "loading" || audioStatus === "unlocking") return;
    const sought = seekAudioElement(audio, position);
    if (sought === null) return;
    restoringOffsetRef.current = false;
    if (activeCheckpointRef.current) activeCheckpointRef.current.positionSec = sought;
    syncPlaybackProgress(true);
    if (audioStatus === "ended" && sought < audio.duration) setAudioStatus("paused");
  }

  function startTour(resumeSaved = true, requestedIndex?: number) {
    if (phase !== "reading" || sessionActiveRef.current) return;
    sessionActiveRef.current = true;

    const audio = audioRef.current;
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    playbackRef.current += 1;
    const playback = playbackRef.current;
    const replay = new URLSearchParams(window.location.search).get("replay") === "clean";
    const initialIndex = requestedIndex !== undefined && requestedIndex >= 0 && requestedIndex < chapters.length ? requestedIndex : resumeSaved && savedChapterIndex >= 0 ? savedChapterIndex : 0;
    const initialPosition = requestedIndex === undefined && resumeSaved && savedCheckpoint ? savedCheckpoint.positionSec : 0;
    const startAudioUrl = chapters[initialIndex]?.audio?.url ?? chapters[initialIndex]?.content.story.audio_url ?? firstPoi.story.audio_url;

    // Keep this call before the first await: iOS grants playback to this exact
    // element only while the click still owns user activation.
    const unlockPromise = audio && !startAudioUrl
      ? unlockAudioElement(audio)
      : Promise.resolve(false);

    setPhase("walking");
    setChapterIndex(initialIndex);
    setChapterCheckpoint(initialIndex, initialPosition);
    setPlaybackTime(initialPosition);
    setAudioStatus(startAudioUrl ? "loading" : "unlocking");
    audioBusyRef.current = true;
    setShowSources(false);
    setIsReplay(replay);
    triggerStateRef.current = createTriggerState();
    setDiagnostics({
      ...initialDiagnostics,
      source: replay ? "replay" : "browser",
      trigger: triggerStateRef.current,
    });

    // Audio readiness must never gate GPS or leave the walk controls disabled.
    if (startAudioUrl) {
      // Start the real clip within this click, retaining iOS user activation.
      void playSignal(startAudioUrl, initialPosition);
    } else {
      void unlockPromise.then((unlocked) => {
        if (sessionRef.current !== session || playbackRef.current !== playback) return;
        audioBusyRef.current = false;
        setAudioStatus(unlocked ? "ready" : "blocked");
      });
    }
    const wakeController = createWakeLockController({
      onChange: (snapshot) => {
        if (sessionRef.current === session) setWakeStatus(snapshot.status);
      },
    });
    wakeControllerRef.current = wakeController;
    setWakeStatus(wakeController.getSnapshot().status);
    void wakeController.request();

    const source = replay
      ? createReplayPositionSource({ fixes: CLEAN_REPLAY_TRACK, intervalMs: 650 })
      : createBrowserPositionSource();

    stopSourceRef.current = source.subscribe((update) => {
      if (sessionRef.current !== session) return;

      if (update.type === "status") {
        setDiagnostics((current) => ({
          ...current,
          sourceStatus: update.status,
          sourceError: "error" in update ? update.error.message : null,
        }));
        return;
      }

      const result = processFix(
        triggerStateRef.current,
        update.fix,
        target,
        triggerConfig,
        audioBusyRef.current,
      );
      triggerStateRef.current = result.state;
      setDiagnostics((current) => ({
        ...current,
        lastFix: update.fix,
        distanceM: result.distanceM,
        trigger: result.state,
      }));

      // The short walk is editorially sequenced by the reader until its stops
      // and recordings are field-checked. GPS must not interrupt a chapter.
      if (result.event?.type === "entered" && !route.walk) void playSignal();
    });
  }

  function stopTour(completed = false) {
    syncPlaybackProgress(true);
    if (completed) clearCheckpoint();
    else if (activeCheckpointRef.current) saveCheckpoint(activeCheckpointRef.current);
    activeCheckpointRef.current = null;
    sessionRef.current += 1;
    sessionActiveRef.current = false;
    playbackRef.current += 1;
    stopSourceRef.current?.();
    stopSourceRef.current = null;
    triggerStateRef.current = createTriggerState();
    audioBusyRef.current = false;
    restoringOffsetRef.current = false;
    if (audioRef.current) stopAudioElement(audioRef.current);
    const wakeController = wakeControllerRef.current;
    wakeControllerRef.current = null;
    void wakeController?.dispose();
    setWakeStatus("idle");
    setAudioStatus("locked");
    setDiagnostics(initialDiagnostics);
    setIsReplay(false);
    setShowSources(false);
    restoreFocusRef.current = true;
    setPhase("reading");
  }

  function selectChapter(index: number) {
    if (!sessionActiveRef.current || index < 0 || index >= chapters.length) return;
    playbackRef.current += 1;
    if (audioRef.current) stopAudioElement(audioRef.current);
    audioBusyRef.current = false;
    setAudioStatus("ready");
    setShowSources(false);
    setChapterIndex(index);
    setChapterCheckpoint(index);
    setPlaybackTime(0);
    setMediaDuration(0);
    restoringOffsetRef.current = false;
    const source = chapters[index].audio?.url ?? chapters[index].content.story.audio_url;
    // Pass the destination explicitly: React state still holds the old chapter
    // during this click. Starting here also preserves mobile user activation.
    if (source) void playSignal(source);
  }

  const isWalking = phase !== "reading";
  const reliableFix =
    diagnostics.sourceStatus === "active" &&
    diagnostics.lastFix &&
    diagnostics.lastFix.accuracyM <= firstPoi.trigger.max_accuracy_m;
  const positionFailed = ["permission-denied", "unavailable", "error"].includes(diagnostics.sourceStatus);
  const signalTone = positionFailed ? "warning" : reliableFix ? "good" : diagnostics.lastFix ? "warning" : "neutral";
  const candidateCount = diagnostics.trigger.recentInside.filter(Boolean).length;
  const statusText = getStatusText(diagnostics, firstPoi.trigger.max_accuracy_m);
  const duration = mediaDuration || chapter?.audio?.duration_sec || walkContent.story.duration_sec;
  const canSeek = !walkUsesTestAudio && mediaDuration > 0 && !["loading", "unlocking", "locked"].includes(audioStatus);
  const audioButtonLabel = audioStatus === "loading" ? "Отменить запуск" : audioStatus === "playing" ? "Пауза" : audioStatus === "paused" ? "Продолжить" : audioStatus === "ended" ? "Слушать ещё раз" : audioStatus === "unlocking" ? "Включить звук" : audioStatus === "blocked" || audioStatus === "error" ? "Повторить запуск звука" : walkUsesTestAudio ? "Проверить звук" : "Слушать историю";
  const chapterNarrative = chapter ? <>
    {chapter.transition ? <p className="walk-transition">{chapter.transition}</p> : null}
    <StoryText story={walkContent.story} />
    <p className="walk-next-hint">{chapter.next_hint}</p>
  </> : null;

  return (
    <main className={isWalking ? "shell" : "around-shell"} data-mode={isWalking ? "walk" : "reading"}>
      {isWalking ? <header className="masthead">
        <a className="wordmark" href="#top" aria-label="Отголосок, на главную">
          Отголосок<span aria-hidden="true">.</span>
        </a>
        <p className="privacy-note"><i aria-hidden="true" /> Координаты остаются на устройстве</p>
      </header> : null}

      {isWalking ? (
        <section className="walk-view" id="top" aria-labelledby="walk-title">
          <div className="walk-status-row">
            <p className={`signal-status ${signalTone}`} role="status">
              <i aria-hidden="true" /> {statusText}
            </p>
            <p className="walk-counter">{chapter ? `Часть ${chapterIndex + 1} из ${chapters.length}` : hasStoryText || !usesTestAudio ? "История 01" : "Тестовая точка"}</p>
          </div>

          <div className="walk-story" data-sequence={chapter ? "true" : undefined}>
            <p className="walk-eyebrow">{chapter?.title ?? firstPoi.eyebrow}</p>
            <h1 id="walk-title" ref={walkTitleRef} tabIndex={-1}>{walkContent.story.opening}</h1>
            <p className="walk-place">{chapter?.place ?? firstPoi.name}</p>
            {chapter?.audio ? <details key={chapter.id} className="walk-transcript">
              <summary>Текст этой части</summary>
              {chapterNarrative}
            </details> : chapterNarrative}
            {walkUsesTestAudio ? <p className="walk-note">{chapter ? "Части переключаются вручную. Запись аудио готовится; кнопка проверки звука включает сигнал на 5 секунд." : hasStoryText ? "Историю можно прочитать ниже. Запись аудио готовится; у точки пока звучит тестовый сигнал на 5 секунд." : "Аудиоистория готовится. У точки прозвучит тестовый сигнал на 5 секунд."}</p> : null}
            {chapter?.audio ? <p className="walk-note">{Math.ceil(chapter.audio.duration_sec)} сек · Синтетическая озвучка. «Дальше» включает следующую часть.</p> : null}
            {!chapter ? <div className="trigger-meter" aria-label={`Подтверждений геопозиции: ${candidateCount} из ${triggerConfig.windowSize}`}>
              {Array.from({ length: triggerConfig.windowSize }, (_, index) => (
                <i key={index} className={index < candidateCount ? "filled" : ""} />
              ))}
            </div> : null}
          </div>

          {!walkUsesTestAudio ? <AudioPlayerControls position={playbackTime} duration={duration}
            canSeek={canSeek} playing={audioStatus === "playing"} label={audioButtonLabel}
            onToggle={toggleAudio} onSeek={seekPlayback} /> : <div className="walk-controls">
            <button className="audio-button" type="button" onClick={toggleAudio}>{audioButtonLabel}</button>
          </div>}

          {chapter ? <nav className="chapter-navigation" aria-label="Части прогулки">
            <button type="button" className="chapter-previous" disabled={chapterIndex === 0} onClick={() => selectChapter(chapterIndex - 1)}>Назад</button>
            <button type="button" className="chapter-next" onClick={() => chapterIndex + 1 < chapters.length ? selectChapter(chapterIndex + 1) : stopTour(true)}>
              {chapterIndex + 1 < chapters.length ? `Дальше: ${chapters[chapterIndex + 1].title}` : "Закончить маршрут"}
            </button>
          </nav> : null}

          {chapters.length > 1 ? <nav className="chapter-list" aria-labelledby="chapter-list-title">
            <h2 id="chapter-list-title">Части прогулки</h2>
            <p>Нажмите на часть, чтобы слушать с начала.</p>
            <ol>
              {chapters.map((item, index) => <li key={item.id}>
                <button type="button" aria-current={index === chapterIndex ? "step" : undefined}
                  onClick={() => selectChapter(index)}>
                  <span className="chapter-list-index" aria-hidden="true">{index + 1}</span>
                  <span className="chapter-list-title">{item.title}
                    {index === chapterIndex ? <small>Текущая часть</small> : null}
                  </span>
                  <span className="chapter-list-duration">{formatPlaybackTime(item.audio?.duration_sec ?? item.duration_sec)}</span>
                </button>
              </li>)}
            </ol>
          </nav> : null}

          <div className="walk-controls">
            <button className="stop-button" type="button" onClick={() => void stopTour()}>
              Выйти из прогулки
            </button>
          </div>

          <p className="walk-note" role="status">
            {audioStatus === "unlocking" ? "Проверяем запуск звука. Можно включить его кнопкой." : audioStatus === "loading" ? "Запускаем звук…" : audioStatus === "blocked" ? "Звук не запустился. Нажмите кнопку, чтобы попробовать ещё раз." : audioStatus === "error" ? "Не удалось воспроизвести аудио. Попробуйте запустить его ещё раз." : ""}
          </p>
          {hasStoryText && !chapter ? <details className="walk-transcript">
            <summary>Читать историю · около {storyMinutes} мин</summary>
            <StoryText story={firstPoi.story} />
          </details> : null}
          <StorySources content={walkContent} open={showSources} onToggle={() => setShowSources((value) => !value)} />
          {!chapter ? <RouteNotes notes={readyNotes} /> : null}

          <details className="debug-panel" open={isReplay || undefined}>
            <summary>Диагностика {isReplay ? "· replay" : ""}</summary>
            <dl>
              <DebugValue label="Источник" value={diagnostics.source ?? "—"} />
              <DebugValue label="Геопозиция" value={sourceLabels[diagnostics.sourceStatus]} />
              <DebugValue label="Точность" value={diagnostics.lastFix ? `${Math.round(diagnostics.lastFix.accuracyM)} м` : "—"} />
              <DebugValue label={route.walk ? "До финиша по прямой" : "До точки"} value={diagnostics.distanceM === null ? "—" : `${Math.round(diagnostics.distanceM)} м`} />
              <DebugValue label="Кандидаты" value={`${candidateCount} / ${diagnostics.trigger.recentInside.length || triggerConfig.windowSize}`} />
              <DebugValue label="Триггер" value={diagnostics.trigger.phase} />
              <DebugValue label="Аудио" value={audioLabels[audioStatus]} />
              <DebugValue label="Экран" value={wakeLabels[wakeStatus]} />
            </dl>
            {diagnostics.sourceError ? <p className="debug-error">{diagnostics.sourceError}</p> : null}
          </details>
        </section>
      ) : (
        <AroundScreen route={route} onStart={(index) => startTour(index === undefined, index)} updateAvailable={updateAvailable}>
          <section className="hero" id="top">
            <div className="hero-copy">
              <p className="kicker">{route.status === "draft" ? "Маршрут в подготовке" : "Аудиопрогулка № 01"} · {route.city}</p>
              <h1>{route.title}</h1>
              <p className="dek">{route.subtitle}</p>
              <dl className="route-facts">
                <div><dt>{route.status === "draft" ? "План пути" : "Путь"}</dt><dd>{route.walk ? `≈ ${Math.round(route.walk.distance_m / 50) * 50} м` : `${route.distance_km.toLocaleString("ru-RU")} км`}</dd></div>
                <div><dt>{route.status === "draft" ? "План времени" : "Время"}</dt><dd>{route.duration_min} минут</dd></div>
                <div><dt>Сейчас доступно</dt><dd>{chapter ? `${chapters.length} части · ${hasWalkAudio ? "аудио и текст" : "текст"}` : hasStoryText && usesTestAudio ? "История · текст" : usesTestAudio ? "Тестовая точка" : "Первая история"}</dd></div>
              </dl>
              <button className="start-button" type="button" ref={startButtonRef} onClick={() => void startTour()}>
                <span>{savedCheckpoint ? "Продолжить прогулку" : "Начать прогулку"}</span><b aria-hidden="true">→</b>
              </button>
              {savedCheckpoint && savedChapterIndex >= 0 ? <>
                <p className="start-note">Часть {savedChapterIndex + 1} · {chapters[savedChapterIndex].title} · {formatPlaybackTime(savedCheckpoint.positionSec)}</p>
                <button type="button" className="restart-walk" onClick={() => startTour(false)}>Начать сначала</button>
              </> : null}
              <p className="start-note">{route.walk ? hasWalkAudio ? "Около 8 минут ходьбы без остановок. Первая запись включится при старте, следующие по кнопке «Дальше». Синтетическая озвучка." : "Около 8 минут ходьбы без остановок. Рассказы переключаются вручную; озвучка готовится." : usesTestAudio ? "Проверка геолокации и звука на одной точке. Запись аудио готовится." : "Разрешите звук и геолокацию после нажатия."}</p>
              {chapters.length > 0 ? <a className="read-story-link" href="#walk-plan">Как пойдём · четыре части <span aria-hidden="true">↓</span></a> : null}
              <a className="read-story-link" href="/create">Подготовить историю другого дома <span aria-hidden="true">→</span></a>
              {hasStoryText ? <a className="read-story-link" href="#story">{route.walk ? "История на финише" : "Читать первую историю"} · около {storyMinutes} мин <span aria-hidden="true">↓</span></a> : null}
              {readyNotes.length > 0 ? <div><a className="read-story-link" href="#along-the-way">По дороге · короткие заметки ({readyNotes.length}) <span aria-hidden="true">↓</span></a></div> : null}
              <p className="start-note" role="status">{offlineStatus}</p>
              <div className="update-control">
                {updateAvailable ? <p role="status">Доступна новая версия сайта.</p> : null}
                <a href="/update.html">{updateAvailable ? "Обновить прогулку" : "Проверить обновление"}</a>
              </div>
            </div>

            <RouteMap route={route} />
          </section>

          <WalkPlanPreview chapters={chapters} />
          <section className="story-preview" id="story" aria-labelledby="story-title">
            <div className="story-number">{route.walk ? "04" : "01"}</div>
            <div>
              <p className="kicker">{hasStoryText ? firstPoi.name : "История в подготовке"}</p>
              <h2 id="story-title">{firstPoi.story.opening}</h2>
              <p>{hasStoryText ? `Около ${storyMinutes} минут чтения.${hasWalkAudio ? " Озвучка доступна в четвёртой части прогулки." : usesTestAudio ? " Запись аудио готовится." : ""}` : "Короткая история с источниками рядом с местом событий."}</p>
              {hasStoryText ? <StoryText story={firstPoi.story} /> : null}
            </div>
            <StorySources content={firstPoi} open={showSources} onToggle={() => setShowSources((value) => !value)} />
          </section>
          <RouteNotes notes={readyNotes} narrated={hasWalkAudio} />
        </AroundScreen>
      )}

      <audio ref={audioRef} preload="auto" aria-label="Аудиогид"
        onTimeUpdate={() => syncPlaybackProgress()}
        onLoadedMetadata={() => {
          if (sessionActiveRef.current && audioRef.current && Number.isFinite(audioRef.current.duration)) setMediaDuration(audioRef.current.duration);
        }}
        onSeeked={() => syncPlaybackProgress(true)}
        onPlaying={() => {
          if (sessionActiveRef.current && audioRef.current && !audioRef.current.paused) {
            audioBusyRef.current = true;
            setAudioStatus("playing");
          }
        }}
        onEnded={() => { if (audioRef.current?.ended) finishAudio(); }}
        onPause={() => { if (audioRef.current?.paused) finishAudio(); }}
        onError={() => {
          if (sessionActiveRef.current && phase === "walking" && audioRef.current?.error) {
            playbackRef.current += 1;
            audioBusyRef.current = false;
            setAudioStatus("error");
          }
        }} />
    </main>
  );
}

function DebugValue({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function getStatusText(
  diagnostics: Diagnostics,
  maxAccuracyM: number,
) {
  if (diagnostics.sourceStatus === "permission-denied") return "Нет доступа к геолокации · звук доступен по кнопке";
  if (diagnostics.sourceStatus === "unavailable" || diagnostics.sourceStatus === "error") return "Нет сигнала GPS · звук доступен по кнопке";
  if (diagnostics.sourceStatus === "complete") return "Тестовый трек завершён";
  if (!diagnostics.lastFix) return "Ищем сигнал GPS…";
  if (diagnostics.lastFix.accuracyM > maxAccuracyM) return `Уточняем позицию · ±${Math.round(diagnostics.lastFix.accuracyM)} м`;
  if (diagnostics.trigger.phase === "inside") return "Вы у точки";
  if (diagnostics.trigger.phase === "cooldown") return "Точка пройдена";
  return `Слушаем город · ±${Math.round(diagnostics.lastFix.accuracyM)} м`;
}
