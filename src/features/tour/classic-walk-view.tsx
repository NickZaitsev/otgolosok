import type { RefObject } from "react";
import type { TriggerConfig } from "@/lib/geo/types";
import type { WakeLockStatus } from "@/lib/wake-lock";
import { formatPlaybackTime } from "@/lib/audio/playback-progress";
import type { Route, WalkStep } from "./types";
import { StorySources, StoryText } from "./story-content";
import { RouteNotes } from "./route-notes";
import { WalkMap } from "./walk-map";
import type { WalkChapter } from "./walk-plan";
import { AudioPlayerControls } from "./audio-player-controls";
import { advanceModeHints, advanceModeLabels, advanceModes, type AdvanceMode, type PlaybackRate, type WalkSettings } from "./walk-settings";
import type { AudioStatus } from "./use-walk-audio";
import { getStatusText, positionFailed, signalTone, type Diagnostics } from "./use-walk-position";
import { WalkDiagnostics } from "./walk-diagnostics";

export type PlayerState = {
  status: AudioStatus;
  position: number;
  duration: number;
  canSeek: boolean;
  label: string;
  /** Recording of the current chapter; null while none is prepared. */
  source: string | null;
  /** The bundled walk plays a short test tone where a recording is not ready yet. */
  testTone: boolean;
};

/** The bundled walk while it is running: status, story, player, chapters and the walk map. */
export function ClassicWalkView({
  route, chapters, chapterIndex, titleRef, diagnostics, triggerConfig, player, wakeStatus,
  settings, onSettings, showSources, onToggleSources, debug, onToggle, onSeek, onSelect, onStop,
}: {
  route: Route;
  chapters: WalkChapter[];
  chapterIndex: number;
  titleRef: RefObject<HTMLHeadingElement | null>;
  diagnostics: Diagnostics;
  triggerConfig: TriggerConfig;
  player: PlayerState;
  wakeStatus: WakeLockStatus;
  settings: WalkSettings;
  onSettings: (patch: Partial<WalkSettings>) => void;
  showSources: boolean;
  onToggleSources: () => void;
  debug: { show: boolean; replay: boolean };
  onToggle: () => void;
  onSeek: (position: number) => void;
  onSelect: (index: number) => void;
  onStop: (completed?: boolean) => void;
}) {
  const firstPoi = route.pois[0];
  const chapter = chapters[chapterIndex];
  const walkContent = chapter?.content ?? firstPoi;
  const hasStoryText = firstPoi.story.text_status === "ready" && firstPoi.story.paragraphs.length > 0;
  const usesTestAudio = !firstPoi.story.audio_url;
  const storyMinutes = Math.ceil(firstPoi.story.duration_sec / 60);
  const readyNotes = (route.notes ?? []).filter((note) => note.story.text_status === "ready" && note.story.paragraphs.length > 0);
  const hasNextChapter = chapterIndex + 1 < chapters.length;
  const maxAccuracyM = firstPoi.trigger.max_accuracy_m;
  const candidateCount = diagnostics.trigger.recentInside.filter(Boolean).length;
  const { status } = player;
  const chapterNarrative = chapter ? <>
    {chapter.transition ? <p className="walk-transition">{chapter.transition}</p> : null}
    {chapter.status && !["ready", "text_ready"].includes(chapter.status) ? <p className="walk-note" role="status">{walkStatusLabel(chapter.status)}</p> : null}
    {walkContent.story.paragraphs.length ? <StoryText story={walkContent.story} /> : null}
    <p className="walk-next-hint">{chapter.next_hint}</p>
  </> : null;

  return (
    <section className="walk-view" id="top" aria-labelledby="walk-title">
      <div className="walk-status-row">
        <p className={`signal-status ${signalTone(diagnostics, maxAccuracyM)}`} role="status">
          <i aria-hidden="true" /> {getStatusText(diagnostics, maxAccuracyM)}
        </p>
        <p className="walk-counter">{chapter ? `Часть ${chapterIndex + 1} из ${chapters.length}` : hasStoryText || !usesTestAudio ? "История" : "Тестовая точка"}</p>
      </div>

      <div className="walk-story" data-sequence={chapter ? "true" : undefined}>
        <p className="walk-eyebrow">{chapter?.title ?? firstPoi.eyebrow}</p>
        <h1 id="walk-title" ref={titleRef} tabIndex={-1}>{walkContent.story.opening}</h1>
        <p className="walk-place">{chapter?.place ?? firstPoi.name}</p>
        {chapter?.audio ? <details key={chapter.id} className="walk-transcript">
          <summary>Текст этой части</summary>
          {chapterNarrative}
        </details> : chapterNarrative}
        {player.testTone ? <p className="walk-note">{chapter ? "Части переключаются вручную. Запись аудио готовится; кнопка проверки звука включает сигнал на 5 секунд." : hasStoryText ? "Историю можно прочитать ниже. Запись аудио готовится; у точки пока звучит тестовый сигнал на 5 секунд." : "Аудиоистория готовится. У точки прозвучит тестовый сигнал на 5 секунд."}</p> : null}
        {chapter?.audio ? <p className="walk-note">{Math.ceil(chapter.audio.duration_sec)} сек · Озвучка доступна. «Дальше» включает следующую часть.</p> : null}
        {!chapter ? <div className="trigger-meter" role="meter" aria-label="Подтверждения геопозиции" aria-valuemin={0} aria-valuemax={triggerConfig.windowSize} aria-valuenow={candidateCount} aria-valuetext={`${candidateCount} из ${triggerConfig.windowSize}`}>
          {Array.from({ length: triggerConfig.windowSize }, (_, index) => (
            <i key={index} className={index < candidateCount ? "filled" : ""} />
          ))}
        </div> : null}
      </div>

      {!player.testTone && player.source ? <AudioPlayerControls position={player.position} duration={player.duration}
        canSeek={player.canSeek} playing={status === "playing"} label={player.label} rate={settings.rate}
        onToggle={onToggle} onSeek={onSeek} onRate={(rate: PlaybackRate) => onSettings({ rate })} /> : <div className="walk-controls">
        {player.testTone ? <button className="audio-button" type="button" onClick={onToggle}>{player.label}</button> : <p className="walk-note" role="status">Для этой части пока нет аудиозаписи. Текст доступен ниже.</p>}
      </div>}

      {chapter ? <nav className="chapter-navigation" aria-label="Части прогулки">
        <button type="button" className="chapter-previous" disabled={chapterIndex === 0} onClick={() => onSelect(chapterIndex - 1)}>Назад</button>
        <button type="button" className="chapter-next" onClick={() => hasNextChapter ? onSelect(chapterIndex + 1) : onStop(true)}>
          {hasNextChapter ? `Дальше: ${chapters[chapterIndex + 1].title}` : "Закончить маршрут"}
        </button>
      </nav> : null}

      {chapter ? <WalkMap chapters={chapters} index={chapterIndex} path={route.walk?.path}
        user={diagnostics.lastFix} distanceToNextM={hasNextChapter ? diagnostics.distanceM : null}
        onSelect={onSelect} /> : null}

      {chapter ? <section className="walk-advance" aria-labelledby="walk-advance-title">
        <h2 id="walk-advance-title">Как включать следующую часть</h2>
        <div className="walk-advance-options" role="group" aria-labelledby="walk-advance-title">
          {advanceModes.map((mode: AdvanceMode) => <button key={mode} type="button"
            aria-pressed={settings.advance === mode}
            onClick={() => onSettings({ advance: mode })}>{advanceModeLabels[mode]}</button>)}
        </div>
        <p>{advanceModeHints[settings.advance]}</p>
        {settings.advance === "place" && positionFailed(diagnostics)
          ? <p className="walk-advance-warning" role="status">Геолокация недоступна, сама часть не включится. Пользуйтесь кнопкой «Дальше».</p>
          : null}
      </section> : null}

      {chapters.length > 1 ? <nav className="chapter-list" aria-labelledby="chapter-list-title">
        <h2 id="chapter-list-title">Части прогулки</h2>
        <p>Нажмите на часть, чтобы слушать с начала.</p>
        <ol>
          {chapters.map((item, index) => <li key={item.id}>
            <button type="button" aria-current={index === chapterIndex ? "step" : undefined}
              onClick={() => onSelect(index)}>
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
        <button className="stop-button" type="button" onClick={() => onStop()}>
          Выйти из прогулки
        </button>
      </div>

      <p className="walk-note" role="status">
        {status === "unlocking" ? "Проверяем запуск звука. Можно включить его кнопкой." : status === "loading" ? "Запускаем звук…" : status === "blocked" ? "Звук не запустился. Нажмите кнопку, чтобы попробовать ещё раз." : status === "error" ? "Не удалось воспроизвести аудио. Попробуйте запустить его ещё раз." : ""}
      </p>
      {hasStoryText && !chapter ? <details className="walk-transcript">
        <summary>Читать историю · около {storyMinutes} мин</summary>
        <StoryText story={firstPoi.story} />
      </details> : null}
      {walkContent.story.text_status === "ready" && walkContent.sources.length ? <StorySources content={walkContent} open={showSources} onToggle={onToggleSources} /> : null}
      {!chapter ? <RouteNotes notes={readyNotes} /> : null}

      {debug.show ? <WalkDiagnostics diagnostics={diagnostics} replay={debug.replay}
        distanceLabel={chapter ? hasNextChapter ? "До следующей части" : "До финиша" : "До точки"}
        triggerConfig={triggerConfig} advance={settings.advance} audioStatus={status} wakeStatus={wakeStatus} /> : null}
    </section>
  );
}

function walkStatusLabel(status: NonNullable<WalkStep["status"]>) {
  return {
    not_requested: "История для этой остановки ещё не заказана.",
    preparing: "История готовится. Остановку можно пройти вручную.",
    failed: "Подготовка истории прервалась. Текст пока недоступен.",
    review_required: "История ожидает редакторской проверки.",
    insufficient_evidence: "Для истории пока не хватило подтверждённых источников.",
    unavailable: "История этой остановки пока недоступна.",
    text_ready: "Текст готов; аудиозапись ещё не подготовлена.",
    ready: "История готова.",
  }[status];
}
