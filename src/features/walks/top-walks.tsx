"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { toUserMessage } from "@/lib/errors/user-message";
import { formatRatingSummary } from "../reviews/model";
import { loadJson } from "./walk-loader";
import { filterTopWalks, formatTopWalkMeta, topWalkHref, validateTopWalks, type TopWalk } from "./top-model";
import styles from "./top-walks.module.css";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; walks: TopWalk[] };

function RoutePreview({ points }: { points: TopWalk["preview"] }) {
  if (!points) return <span className={styles.previewFallback} aria-hidden="true">↗</span>;
  const first = points[0], last = points.at(-1)!;
  return <svg className={styles.previewRoute} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <polyline points={points.map(([x, y]) => `${x},${y}`).join(" ")} />
    <circle className={styles.previewStart} cx={first[0]} cy={first[1]} r="5" />
    <circle className={styles.previewEnd} cx={last[0]} cy={last[1]} r="5" />
  </svg>;
}

/** The public ranking of walks. Its list loads once when the screen opens. */
export function TopWalks({ filterable = false }: { filterable?: boolean }) {
  const { languageTag, locale, path, t } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [startFilter, setStartFilter] = useState("");
  const [endFilter, setEndFilter] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    loadJson("/api/top-walks", controller.signal, validateTopWalks)
      .then(walks => setState({ status: "ready", walks }))
      .catch(caught => { if (!controller.signal.aborted) setState({ status: "error", message: toUserMessage(caught, "Не удалось загрузить топ прогулок.", locale) }); });
    return () => controller.abort();
  }, [attempt, locale]);

  if (state.status === "loading") return <p role="status" className="ui-muted">{t("Загружаем топ прогулок…")}</p>;
  if (state.status === "error") return <p role="alert" className="ui-notice">{state.message}{" "}
    <button type="button" className={styles.retry} onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}>{t("Повторить")}</button></p>;
  if (!state.walks.length) return <p className={styles.empty}>{t("В топе пока пусто. Откройте свою прогулку всем — после проверки она появится здесь.")}</p>;

  const options = (part: "startMetro" | "endMetro") => [...new Set(state.walks.flatMap(walk => walk[part] ? [walk[part].name] : []))].sort((a, b) => a.localeCompare(b, languageTag));
  const starts = options("startMetro"), ends = options("endMetro");
  const visible = filterTopWalks(state.walks, startFilter, endFilter);
  return <>
    {filterable && (starts.length || ends.length) ? <div className={styles.filters} role="group" aria-label={t("Фильтры по метро")}>
      <label>{t("Ближайшее метро к старту")}<select value={startFilter} onChange={event => setStartFilter(event.target.value)}><option value="">{t("Любая станция")}</option>{starts.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>{t("Ближайшее метро к финишу")}<select value={endFilter} onChange={event => setEndFilter(event.target.value)}><option value="">{t("Любая станция")}</option>{ends.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      {startFilter || endFilter ? <button type="button" className={styles.reset} onClick={() => { setStartFilter(""); setEndFilter(""); }}>{t("Сбросить фильтры")}</button> : null}
    </div> : null}
    {filterable && (startFilter || endFilter) ? <p className={styles.resultCount} role="status">{t("Найдено: {count}", { count: visible.length })}</p> : null}
    {visible.length ? <ol className={styles.list}>
      {visible.map(walk => <li key={`${walk.kind}:${walk.id}`} className={styles.item}>
        <Link className={styles.card} href={path(topWalkHref(walk))} aria-label={t("Подробнее о маршруте «{title}»", { title: walk.title })}>
          <span className={styles.body}>
            <span className={styles.heading}><span className={styles.rank}>{state.walks.indexOf(walk) + 1}</span><strong className={styles.title}>{walk.title}</strong></span>
            <span className={styles.rating}>{formatRatingSummary(walk.rating, locale) || t("Пока без оценок")}</span>
            <span className={styles.meta}>{formatTopWalkMeta(walk, locale)}</span>
            {walk.startMetro || walk.endMetro ? <span className={styles.metro}>
              <span><span className={styles.metroMark} aria-hidden="true">M</span>{walk.startMetro ? t("Старт: м. {station}", { station: walk.startMetro.name }) : t("Старт: метро не указано")}</span>
              <span><span className={styles.metroMark} aria-hidden="true">M</span>{walk.endMetro ? t("Финиш: м. {station}", { station: walk.endMetro.name }) : t("Финиш: метро не указано")}</span>
            </span> : null}
          </span>
          <span className={styles.preview} aria-hidden="true"><RoutePreview points={walk.preview} /><span className={styles.previewCaption}>{t("Маршрут")}</span></span>
        </Link>
      </li>)}
    </ol> : <p className={styles.empty}>{t("По выбранным станциям прогулок нет.")} <button type="button" className={styles.retry} onClick={() => { setStartFilter(""); setEndFilter(""); }}>{t("Сбросить фильтры")}</button></p>}
  </>;
}
