import { useId } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { ContentLocale, HistoricalContent } from "./types";

const contentLanguageTag = (locale: ContentLocale) => locale === "zh" ? "zh-Hans" : locale;

export function StoryText({ story, contentLocale = "ru" }: { story: HistoricalContent["story"]; contentLocale?: ContentLocale }) {
  return <div className="story-text" lang={contentLanguageTag(contentLocale)}>
    {story.paragraphs.map((paragraph) => <p key={paragraph.id}>{paragraph.text}</p>)}
  </div>;
}

export function StorySources({ content, open, onToggle, contentLocale = "ru" }: {
  content: HistoricalContent;
  open: boolean;
  onToggle: () => void;
  contentLocale?: ContentLocale;
}) {
  const { languageTag, t } = useI18n();
  const sourcesId = useId();
  const checkedAt = content.story.checked_at && !Number.isNaN(new Date(content.story.checked_at).getTime())
    ? new Intl.DateTimeFormat(languageTag, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(content.story.checked_at))
    : null;
  return <div className="source-control">
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={sourcesId}>
      {t(open ? "Скрыть источники" : "Откуда это известно?")}
    </button>
    <div id={sourcesId} hidden={!open}>
      {checkedAt ? <p className="source-note">{t("Проверено по публикациям {date}", { date: checkedAt })}</p> : <p className="source-note">{t("Дата проверки не указана.")}</p>}
      <ol className="source-list" lang="ru">{content.sources.map((source) => (
        <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>
      ))}</ol>
      <details className="fact-details">
        <summary>{t("Факты и подтверждения · {count}", { count: content.facts.length })}</summary>
        <ol className="fact-list" lang={contentLanguageTag(contentLocale)}>{content.facts.map((fact) => (
          <li key={fact.id}>
            <p>{fact.claim}</p>
            {fact.confidence !== "verified" ? <p className="source-note">{t(fact.confidence === "legend" ? "Легенда" : "Требует проверки")}</p> : null}
            {fact.evidence.map((evidence) => {
              const sourceIndex = content.sources.findIndex((source) => source.id === evidence.source_id);
              const source = content.sources[sourceIndex];
              if (!source) return null;
              return <p className="fact-evidence" key={`${evidence.source_id}:${evidence.locator}`}>
                <a lang="ru" href={source.url} target="_blank" rel="noreferrer" aria-label={`${source.title}. ${evidence.locator}`}>
                  [{sourceIndex + 1}] {evidence.locator}
                </a>
                <span lang={contentLanguageTag(contentLocale)}>{evidence.summary}</span>
              </p>;
            })}
          </li>
        ))}</ol>
      </details>
      <p className="source-note" lang={contentLanguageTag(contentLocale)}>{content.editorial_note}</p>
    </div>
  </div>;
}
