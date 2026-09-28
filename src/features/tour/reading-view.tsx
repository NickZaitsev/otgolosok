import type { RefObject } from "react";
import { formatPlaybackTime, type PlaybackCheckpoint } from "@/lib/audio/playback-progress";
import type { Route } from "./types";
import { StorySources, StoryText } from "./story-content";
import { RouteNotes } from "./route-notes";
import { AroundScreen } from "../explore/around-screen";
import { RouteMap } from "./route-map";
import { WalkPlanPreview, type WalkChapter } from "./walk-plan";

/** The walk before it starts: facts, start controls, plan, first story and notes. */
export function ReadingView({
  route, chapters, chapterIndex, savedCheckpoint, startRef, onStart, shellStatus, updateAvailable, showSources, onToggleSources,
}: {
  route: Route;
  chapters: WalkChapter[];
  chapterIndex: number;
  savedCheckpoint: PlaybackCheckpoint | null;
  startRef: RefObject<HTMLButtonElement | null>;
  /** `resumeSaved` continues from the checkpoint; `index` starts at that chapter instead. */
  onStart: (resumeSaved: boolean, index?: number) => void;
  shellStatus: string;
  updateAvailable: boolean;
  showSources: boolean;
  onToggleSources: () => void;
}) {
  const firstPoi = route.pois[0];
  const chapter = chapters[chapterIndex];
  // Universal walks never reach this screen, so a missing recording means the bundled test tone.
  const usesTestAudio = !firstPoi.story.audio_url;
  const hasStoryText = firstPoi.story.text_status === "ready" && firstPoi.story.paragraphs.length > 0;
  const storyMinutes = Math.ceil(firstPoi.story.duration_sec / 60);
  const readyNotes = (route.notes ?? []).filter((note) => note.story.text_status === "ready" && note.story.paragraphs.length > 0);
  const hasWalkAudio = chapters.length > 0 && chapters.every((item) => item.audio?.url);
  const savedChapterIndex = savedCheckpoint ? chapters.findIndex((item) => item.id === savedCheckpoint.chapterId) : -1;

  return (
    <AroundScreen route={route} onStart={(index) => onStart(index === undefined, index)} updateAvailable={updateAvailable}>
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker">{route.status === "draft" ? "Маршрут в подготовке" : `Аудиопрогулка · ${route.city}`}</p>
          <h1>{route.title}</h1>
          <p className="dek">{route.subtitle}</p>
          <dl className="route-facts">
            <div><dt>{route.status === "draft" ? "План пути" : "Путь"}</dt><dd>{route.walk ? `≈ ${Math.round(route.walk.distance_m / 50) * 50} м` : `${route.distance_km.toLocaleString("ru-RU")} км`}</dd></div>
            <div><dt>{route.status === "draft" ? "План времени" : "Время"}</dt><dd>{route.duration_min} минут</dd></div>
            <div><dt>Сейчас доступно</dt><dd>{chapter ? `${chapters.length} части · ${hasWalkAudio ? "аудио и текст" : "текст"}` : hasStoryText && usesTestAudio ? "История · текст" : usesTestAudio ? "Тестовая точка" : "Первая история"}</dd></div>
          </dl>
          <button className="start-button" type="button" ref={startRef} onClick={() => onStart(true)}>
            <span>{savedCheckpoint ? "Продолжить прогулку" : "Начать прогулку"}</span><b aria-hidden="true">→</b>
          </button>
          {savedCheckpoint && savedChapterIndex >= 0 ? <>
            <p className="start-note">Часть {savedChapterIndex + 1} · {chapters[savedChapterIndex].title} · {formatPlaybackTime(savedCheckpoint.positionSec)}</p>
            <button type="button" className="restart-walk" onClick={() => onStart(false)}>Начать сначала</button>
          </> : null}
          <p className="start-note">{route.walk ? hasWalkAudio ? `Около ${route.duration_min} минут ходьбы без остановок. Первая запись включится при старте, следующие по кнопке «Дальше». Озвучка доступна.` : `Около ${route.duration_min} минут ходьбы без остановок. Рассказы переключаются вручную; озвучка готовится.` : usesTestAudio ? "Проверка геолокации и звука на одной точке. Запись аудио готовится." : "Разрешите звук и геолокацию после нажатия."}</p>
          {chapters.length > 0 ? <a className="read-story-link" href="#walk-plan">Как пойдём · {chapters.length} {chapterWord(chapters.length)} <span aria-hidden="true">↓</span></a> : null}
          <a className="read-story-link" href="/create">Подготовить историю другого дома <span aria-hidden="true">→</span></a>
          {hasStoryText ? <a className="read-story-link" href="#story">Читать первую историю · около {storyMinutes} мин <span aria-hidden="true">↓</span></a> : null}
          {readyNotes.length > 0 ? <div><a className="read-story-link" href="#along-the-way">По дороге · короткие заметки ({readyNotes.length}) <span aria-hidden="true">↓</span></a></div> : null}
          {shellStatus ? <p className="start-note" role="status">{shellStatus}</p> : null}
          <div className="update-control">
            {updateAvailable ? <p role="status">Доступна новая версия сайта.</p> : null}
            <a href="/update.html">{updateAvailable ? "Обновить прогулку" : "Проверить обновление"}</a>
          </div>
        </div>

        <RouteMap route={route} />
      </section>

      <WalkPlanPreview chapters={chapters} />
      <section className="story-preview" id="story" aria-labelledby="story-title">
        <div className="story-number">{String(Math.min(99, Math.max(1, chapterIndex + 1))).padStart(2, "0")}</div>
        <div>
          <p className="kicker">{hasStoryText ? firstPoi.name : "История в подготовке"}</p>
          <h2 id="story-title">{firstPoi.story.opening}</h2>
          <p>{hasStoryText ? `Около ${storyMinutes} минут чтения.${hasWalkAudio ? " Озвучка доступна в записи прогулки." : usesTestAudio ? " Запись аудио готовится." : ""}` : "Короткая история с источниками рядом с местом событий."}</p>
          {hasStoryText ? <StoryText story={firstPoi.story} /> : null}
        </div>
        {firstPoi.story.text_status === "ready" && firstPoi.sources.length ? <StorySources content={firstPoi} open={showSources} onToggle={onToggleSources} /> : null}
      </section>
      <RouteNotes notes={readyNotes} narrated={hasWalkAudio} />
    </AroundScreen>
  );
}

function chapterWord(value: number) {
  const remainder = value % 10;
  const tens = value % 100;
  return tens >= 11 && tens <= 14 ? "частей" : remainder === 1 ? "часть" : remainder >= 2 && remainder <= 4 ? "части" : "частей";
}
