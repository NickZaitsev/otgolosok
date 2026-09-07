import type { HistoricalContent, Route, WalkStep } from "./types";

export type WalkChapter = WalkStep & { content: HistoricalContent };

export function getWalkChapters(route: Route): WalkChapter[] {
  const contentById = new Map([...route.pois, ...(route.notes ?? [])].map((content) => [content.id, content]));
  return (route.walk?.steps ?? []).flatMap((step) => {
    const content = contentById.get(step.content_id);
    return content?.story.text_status === "ready" ? [{ ...step, content }] : [];
  });
}

export function WalkPlanPreview({ chapters }: { chapters: WalkChapter[] }) {
  if (chapters.length === 0) return null;
  const hasAudio = chapters.every((chapter) => chapter.audio?.url);
  return <section className="walk-plan" id="walk-plan" aria-labelledby="walk-plan-title">
    <p className="kicker">От переулков к фабричному кварталу</p>
    <h2 id="walk-plan-title">Одна прогулка, четыре истории</h2>
    <p className="walk-plan-intro">Начните прогулку, чтобы {hasAudio ? "слушать" : "читать"} рассказы по порядку. Между частями есть переходы; двигаться дальше можно в своём темпе.</p>
    <ol className="walk-plan-steps">
      {chapters.map((chapter, index) => <li key={chapter.id}>
        <span className="walk-plan-index" aria-hidden="true">{index + 1}</span>
        <div><h3>{chapter.title}</h3><p>{chapter.place}</p></div>
        <span className="walk-plan-duration">{chapter.audio ? "" : "≈ "}{chapter.duration_sec} сек</span>
      </li>)}
    </ol>
    <p className="walk-plan-intro">{hasAudio ? "Четыре записи с синтетической озвучкой. «Дальше» включает следующую часть; текст и источники остаются под рукой." : "Пока доступен текст. Части переключаются вручную, озвучка готовится."}</p>
  </section>;
}
