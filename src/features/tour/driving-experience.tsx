"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { useHideNavigation } from "../navigation/navigation-visibility";
import { ContentLanguageNote } from "@/lib/i18n/content-language-note";
import type { ReviewTarget } from "../reviews/model";
import { ReviewDialog } from "../reviews/review-dialog";
import { useWalkReviews } from "../reviews/use-walk-reviews";
import { ExploreIcon } from "../explore/icons";
import { MapShell } from "../shell/map-shell";
import { MapNotice } from "../shell/map-status-notice";
import { Sheet } from "../shell/sheet";
import { yandexNavigationUrl } from "../travel/navigation";
import type { OfflineWalkRef } from "../walks/offline";
import type { OwnWalk } from "../walks/own-walk";
import { useLaunchReport } from "../walks/launches";
import type { WalkView } from "../walks/model";
import { walkViewToRoute } from "../walks/adapters";
import { AudioPlayerControls } from "./audio-player-controls";
import {
  advanceDrivingPlan,
  clearDrivingProgress,
  currentDrivingStopId,
  currentDrivingVisit,
  drivingAudioAllowed,
  initialDrivingPlanState,
  loadDrivingProgress,
  saveDrivingProgress,
  type DrivingPlanAction,
  type DrivingPlanOptions,
  type DrivingPlanState,
  type DrivingRoute,
} from "./driving-plan";
import { OfflineCopyControls, useOfflineCopy } from "./offline-copy";
import { getWalkChapters } from "./walk-plan";
import { setWalkInProgress } from "./walk-activity";
import { StorySources, StoryText } from "./story-content";
import type { PlaybackRate } from "./walk-settings";
import styles from "./driving-experience.module.css";

type DrivingDocument = WalkView["document"] & {
  travelMode?: "walking" | "driving";
  route: (NonNullable<WalkView["document"]["route"]> & { car?: DrivingRoute }) | null;
};

export type DrivingExperienceProps = {
  view: WalkView;
  offline?: OfflineWalkRef | null;
  offlineRef?: OfflineWalkRef | null;
  offlineNotice?: string;
  reviewTarget?: ReviewTarget | null;
  launchTarget?: ReviewTarget | null;
  own?: OwnWalk | null;
  onStop?: () => void;
};

const noop = () => {};

function parkingFeeLabel(fee: boolean | null) {
  return fee === true ? "Парковка платная" : fee === false ? "Парковка бесплатная" : "Плата за парковку неизвестна";
}

function phaseNotice(state: DrivingPlanState, route: DrivingRoute, t: ReturnType<typeof useI18n>["t"]) {
  if (state.phase === "driving") {
    const segment = route.segments.find(item => item.mode === "driving" && item.visitId === route.visits[state.visitIndex]?.id);
    return t("До парковки · около {minutes} мин", { minutes: Math.max(1, Math.ceil(segment?.minutes ?? 0)) });
  }
  if (state.phase === "returning") return t("Машина ждёт на парковке");
  if (state.phase === "finishing") return t("До финиша");
  return "";
}

export function DrivingExperience({
  view,
  offline = null,
  offlineRef = null,
  offlineNotice = "",
  reviewTarget = null,
  launchTarget = null,
  own = null,
  onStop,
}: DrivingExperienceProps) {
  const { path, t } = useI18n();
  const document = view.document as DrivingDocument;
  const car = document.route?.car;
  const finishRequired = document.mode === "loop" || Boolean(document.destination);
  const options = useMemo<DrivingPlanOptions>(() => ({ finishRequired }), [finishRequired]);
  const legacyRoute = useMemo(() => walkViewToRoute(view), [view]);
  const chapters = useMemo(() => getWalkChapters(legacyRoute, true), [legacyRoute]);
  const chapterById = useMemo(() => new Map(chapters.map(chapter => [chapter.id, chapter])), [chapters]);
  const offlineCopy = useOfflineCopy(view, offline ?? offlineRef);
  const reviews = useWalkReviews(reviewTarget);
  const reportLaunch = useLaunchReport(launchTarget);
  const [rateOpen, setRateOpen] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [rate, setRate] = useState<PlaybackRate>(1);
  const startRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audio, setAudio] = useState({ playing: false, position: 0, duration: 0, error: "" });

  const [state, setState] = useState<DrivingPlanState>(initialDrivingPlanState);
  const [progressReady, setProgressReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Restore browser storage after hydration; the server and initial client render agree.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        if (car) setState(loadDrivingProgress(window.localStorage, document.id, view.revision, car, options));
      } catch {
        // Some browsers forbid access to localStorage itself, before getItem can run.
        setState(initialDrivingPlanState());
      }
      setProgressReady(true);
    });
    return () => { cancelled = true; };
  }, [car, document.id, view.revision, options]);

  const visit = car ? currentDrivingVisit(state, car) : null;
  const stopId = car ? currentDrivingStopId(state, car) : null;
  const chapter = stopId ? chapterById.get(stopId) ?? null : null;
  const storySource = state.phase === "visiting" ? chapter?.audio?.url ?? null : null;
  const active = state.phase !== "overview" && state.phase !== "complete";
  useHideNavigation(active);

  const focusStory = state.phase === "visiting" ? state.storyIndex : -1;
  useEffect(() => {
    setWalkInProgress(active);
    return () => setWalkInProgress(false);
  }, [active]);

  useEffect(() => {
    if (!car || !progressReady) return;
    try {
      if (state.phase === "overview" || state.phase === "complete") clearDrivingProgress(window.localStorage, document.id);
      else saveDrivingProgress(window.localStorage, document.id, view.revision, state);
    } catch {
      // A trip remains usable when the browser forbids local storage.
    }
  }, [car, document.id, progressReady, state, view.revision]);

  useEffect(() => {
    if (state.phase === "overview") startRef.current?.focus();
    else titleRef.current?.focus({ preventScroll: true });
  }, [state.phase, focusStory]);

  useEffect(() => {
    const media = audioRef.current;
    if (!media) return;
    media.pause();
    media.currentTime = 0;
    media.load();
  }, [storySource, chapter?.audio?.duration_sec]);

  useEffect(() => {
    if (drivingAudioAllowed(state)) return;
    const media = audioRef.current;
    if (media) {
      media.pause();
      media.currentTime = 0;
    }
  }, [state]);

  if (!car) {
    return <main className={styles.missing}>
      <h1>{t("Автомобильная прогулка")}</h1>
      <p role="alert">{t("В этой прогулке ещё нет маршрута. Постройте его в редакторе из истории.")}</p>
      {own ? <Link href={path(own.editHref)}>{t("Изменить маршрут")}</Link> : <Link href={path("/")}>{t("На карту")}</Link>}
    </main>;
  }

  function transition(action: DrivingPlanAction) {
    if (!car) return;
    // Stop playback before leaving a story, including two stories sharing one recording.
    const media = audioRef.current;
    if (media) {
      media.pause();
      media.currentTime = 0;
    }
    setShowSources(false);
    setAudio({ playing: false, position: 0, duration: 0, error: "" });
    if (action.type === "start") reportLaunch();
    setState(current => advanceDrivingPlan(current, action, car, options));
  }

  async function toggleAudio() {
    const media = audioRef.current;
    if (!media || !storySource || !drivingAudioAllowed(state)) return;
    if (!media.paused) {
      media.pause();
      return;
    }
    try {
      media.playbackRate = rate;
      await media.play();
    } catch {
      setAudio(value => ({ ...value, playing: false, error: t("Не удалось воспроизвести аудио. Попробуйте запустить его ещё раз.") }));
    }
  }

  function seekAudio(seconds: number) {
    const media = audioRef.current;
    if (!media || !Number.isFinite(seconds)) return;
    media.currentTime = Math.min(media.duration || audio.duration, Math.max(0, seconds));
  }

  const mapItems = [
    ...car.visits.map((item, index) => ({ id: item.parking.id, title: t("Парковка {current}", { current: index + 1 }), location: item.parking.location, parking: true })),
    ...document.stops.map((stop, index) => ({ id: stop.id, title: stop.place.address, location: stop.triggerLocation ?? stop.place.location, number: index + 1 })),
  ];
  const selectedParking = visit?.parking.id;
  const focus = state.phase === "overview" || state.phase === "complete" ? null : visit?.parking.location ? { ...visit.parking.location, zoom: 16 } : null;
  const notice = [offlineNotice, phaseNotice(state, car, t)].filter(Boolean).join(" · ");
  const routeSegments = car.segments.map(segment => ({ mode: segment.mode, geometry: segment.geometry }));
  const sheet = <DrivingSheet state={state} car={car} visit={visit} chapter={chapter} document={document}
    titleRef={titleRef} startRef={startRef} own={own} offlineCopy={offlineCopy} reviewsAvailable={Boolean(reviewTarget)}
    showSources={showSources} audio={{ ...audio, duration: audio.duration || chapter?.audio?.duration_sec || 0 }} rate={rate} storySource={storySource}
    onSources={() => setShowSources(value => !value)} onRate={() => setRateOpen(true)} onAudio={() => void toggleAudio()}
    onSeek={seekAudio} onPlaybackRate={value => { setRate(value); if (audioRef.current) audioRef.current.playbackRate = value; }}
    onAction={transition} />;

  return <>
    <MapShell navigation={!active} onBrand={() => { audioRef.current?.pause(); setWalkInProgress(false); onStop?.(); }}
      map={{ items: mapItems, selectedId: selectedParking, focus, user: null, onSelect: noop, onPoint: noop,
        routeSegments, fitGeometry: state.phase === "overview" || state.phase === "complete",
        mapLabel: t("Карта автомобильной прогулки: автомобильные переезды, пешие участки, парковки и истории") }}
      notices={notice ? <MapNotice>{notice}</MapNotice> : null} sheet={sheet} />
    <audio ref={audioRef} src={storySource ?? undefined} preload="metadata" aria-label={t("Аудиогид")}
      onLoadedMetadata={event => setAudio(value => ({ ...value, duration: event.currentTarget.duration || value.duration }))}
      onTimeUpdate={event => setAudio(value => ({ ...value, position: event.currentTarget.currentTime }))}
      onPlay={() => setAudio(value => ({ ...value, playing: true, error: "" }))}
      onPause={() => setAudio(value => ({ ...value, playing: false }))}
      onEnded={() => setAudio(value => ({ ...value, playing: false, position: value.duration }))} />
    {reviewTarget ? <ReviewDialog reviews={reviews} open={rateOpen} onClose={() => setRateOpen(false)} walkTitle={document.title.trim() || t("Ваш маршрут")} /> : null}
  </>;
}

type SheetProps = {
  state: DrivingPlanState;
  car: DrivingRoute;
  visit: DrivingRoute["visits"][number] | null;
  chapter: ReturnType<typeof getWalkChapters>[number] | null;
  document: DrivingDocument;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  startRef: React.RefObject<HTMLButtonElement | null>;
  own: OwnWalk | null;
  offlineCopy: ReturnType<typeof useOfflineCopy>;
  reviewsAvailable: boolean;
  showSources: boolean;
  storySource: string | null;
  audio: { playing: boolean; position: number; duration: number; error: string };
  rate: PlaybackRate;
  onSources: () => void;
  onRate: () => void;
  onAudio: () => void;
  onSeek: (seconds: number) => void;
  onPlaybackRate: (rate: PlaybackRate) => void;
  onAction: (action: DrivingPlanAction) => void;
};

function DrivingSheet(props: SheetProps) {
  const { path, t } = useI18n();
  const { state, car, visit, chapter, document, titleRef, startRef, own, offlineCopy, reviewsAvailable, showSources, storySource, audio, rate, onSources, onRate, onAudio, onSeek, onPlaybackRate, onAction } = props;
  let heading = document.title.trim() || t("Ваш маршрут");
  let eyebrow = t("Автомобильная прогулка");
  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (state.phase === "overview") {
    body = <>
      <p className={styles.summary}>{t("Около {minutes} мин · {visits} парковок", { minutes: car.totalMinutes, visits: car.visits.length })}</p>
      <div className={styles.metrics} aria-label={t("Весь маршрут")}>
        <span><b>{car.drivingMinutes}</b>{t("На машине · {minutes} мин", { minutes: car.drivingMinutes }).replace(String(car.drivingMinutes), "").trim()}</span>
        <span><b>{document.stops.length}</b>{t("Части прогулки")}</span>
      </div>
      <ol className={styles.visits}>{car.visits.map((item, index) => <li key={item.id}>
        <span className={styles.visitNumber} aria-hidden="true">P{index + 1}</span>
        <span><b>{item.parking.name}</b><small>{t("Рядом · {count} историй · около {minutes} мин", { count: item.stopIds.length, minutes: item.visitMinutes })}</small></span>
      </li>)}</ol>
      {own?.notes.map((note: string) => <p key={note} className={styles.note}>{note}</p>)}
      <details className={styles.settings}><summary>{t("Сохранить прогулку без сети")}</summary>
        <OfflineCopyControls copy={offlineCopy} statusClassName={styles.note} />
      </details>
    </>;
    footer = <>
      {own ? <Link className={styles.iconAction} href={path(own.editHref)} prefetch={false} aria-label={t("Изменить маршрут")}><ExploreIcon name="arrow" /></Link> : null}
      <button ref={startRef} type="button" className={styles.primary} onClick={() => onAction({ type: "start" })}>{t("Начать поездку")}<ExploreIcon name="arrow" /></button>
    </>;
  } else if (state.phase === "driving" && visit) {
    eyebrow = t("К парковке {current} из {total}", { current: state.visitIndex + 1, total: car.visits.length });
    heading = visit.parking.name;
    const href = yandexNavigationUrl(visit.parking.entrance, "driving");
    body = <>
      <p className={styles.parkingMeta}>{t(parkingFeeLabel(visit.parking.fee))}{visit.parking.openingHours ? <> · {visit.parking.openingHours}</> : null}</p>
      <p>{t("Сначала откройте маршрут в навигаторе. Рассказы включаются только после парковки.")}</p>
      {href ? <a className={styles.navigation} href={href} target="_blank" rel="noopener noreferrer">{t("Маршрут в навигаторе")}<ExploreIcon name="arrow" /></a> : null}
      <p className={styles.audioPaused} role="status">{t("В дороге звук остановлен")}</p>
    </>;
    footer = <button type="button" className={styles.primary} onClick={() => onAction({ type: "parked" })}>{t("Я припарковался / Начать прогулку")}<ExploreIcon name="arrow" /></button>;
  } else if (state.phase === "visiting" && visit) {
    const storyTotal = visit.stopIds.length;
    eyebrow = t("Остановка {current} из {total} у этой парковки", { current: state.storyIndex + 1, total: storyTotal });
    heading = chapter?.title ?? chapter?.place ?? t("История готовится");
    const contentLocale = chapter?.localization?.contentLocale ?? "ru";
    body = chapter ? <>
      {chapter.title !== chapter.place ? <p className={styles.address}>{chapter.place}</p> : null}
      <ContentLanguageNote contentLocale={contentLocale} audioAvailable={Boolean(storySource)} />
      {chapter.content.story.paragraphs.length ? <StoryText story={chapter.content.story} contentLocale={contentLocale} /> : <p className={styles.note} role="status">{t("Для этой части пока нет аудиозаписи. Текст доступен ниже.")}</p>}
      {chapter.content.sources.length ? <StorySources content={chapter.content} contentLocale={contentLocale} open={showSources} onToggle={onSources} /> : null}
      {audio.error ? <p className={styles.error} role="alert">{audio.error}</p> : null}
    </> : <p className={styles.note} role="status">{t("История этой остановки пока недоступна.")}</p>;
    const hasNext = state.storyIndex + 1 < storyTotal;
    footer = <>
      {storySource ? <AudioPlayerControls compact walk position={audio.position} duration={audio.duration}
        canSeek={audio.duration > 0} playing={audio.playing} label={t(audio.playing ? "Пауза" : "Слушать историю")}
        rate={rate} onRate={onPlaybackRate} onToggle={onAudio} onSeek={onSeek} /> : null}
      <button type="button" className={styles.primary} onClick={() => onAction({ type: hasNext ? "next-story" : "return-to-car" })}>
        {t(hasNext ? "Следующая история" : "Вернуться к машине")}<ExploreIcon name="arrow" />
      </button>
    </>;
  } else if (state.phase === "returning" && visit) {
    eyebrow = t("Вернуться к машине");
    heading = visit.parking.name;
    const href = yandexNavigationUrl(visit.parking.pedestrianAccess, "walking");
    const hasNext = state.visitIndex + 1 < car.visits.length;
    body = <>
      <p>{t("Машина ждёт на парковке")}</p>
      {href ? <a className={styles.navigation} href={href} target="_blank" rel="noopener noreferrer">{t("Маршрут к машине")}<ExploreIcon name="arrow" /></a> : null}
    </>;
    footer = <button type="button" className={styles.primary} onClick={() => onAction({ type: "at-car" })}>
      {t(hasNext ? "Я у машины / Следующая парковка" : document.mode === "loop" || document.destination ? "Я у машины / К финишу" : "Я у машины")}<ExploreIcon name="arrow" />
    </button>;
  } else if (state.phase === "finishing") {
    eyebrow = t("К финишу поездки");
    heading = document.destination?.address ?? document.start?.address ?? t("До финиша");
    const target = document.destination?.location ?? document.start?.location;
    const href = yandexNavigationUrl(target, "driving");
    body = href ? <a className={styles.navigation} href={href} target="_blank" rel="noopener noreferrer">{t("Открыть навигатор")}<ExploreIcon name="arrow" /></a> : null;
    footer = <button type="button" className={styles.primary} onClick={() => onAction({ type: "finish-reached" })}>{t("Я на финише")}<ExploreIcon name="arrow" /></button>;
  } else if (state.phase === "complete") {
    eyebrow = t("Автомобильная прогулка");
    heading = t("Поездка завершена");
    body = <p>{t("Маршрут завершён. Спасибо за прогулку.")}</p>;
    footer = <>
      {reviewsAvailable ? <button type="button" className={styles.primary} aria-haspopup="dialog" onClick={onRate}>{t("Оставить отзыв")}</button> : <Link className={styles.primary} href={path("/")}>{t("На карту")}</Link>}
      <button type="button" className={styles.secondary} onClick={() => onAction({ type: "restart" })}>{t("Начать заново")}</button>
    </>;
  }

  return <Sheet name="driving" state={state.phase} labelledBy="driving-title" className={styles.sheet}
    header={<div className={styles.header}><p>{eyebrow}</p><h1 id="driving-title" ref={titleRef} tabIndex={-1}>{heading}</h1></div>}
    footer={<div className={styles.actions}>{footer}</div>}>
    <div className={styles.body}>{body}</div>
  </Sheet>;
}

