"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { toUserMessage } from "@/lib/errors/user-message";
import { formatRatingSummary } from "../reviews/model";
import { loadJson } from "./walk-loader";
import { formatTopWalkMeta, metroTextColor, topWalkHref, topWalksUrl, validateTopWalkPage, type MetroStation, type TopDuration, type TopFilters, type TopWalk, type TopWalkPage } from "./top-model";
import styles from "./top-walks.module.css";

type Ready = TopWalkPage & { status: "ready"; more: "idle" | "loading" | "error"; moreError: string };
type State = { status: "loading" } | { status: "error"; message: string } | Ready;
const emptyFilters: TopFilters = { start: "", end: "", duration: "" };
const tileUrl = (zoom: number, x: number, y: number) => `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;

function RoutePreview({ walk }: { walk: TopWalk }) {
  const frame = useRef<HTMLSpanElement>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [attempt, setAttempt] = useState(0);
  const [mapFailed, setMapFailed] = useState(false);
  useEffect(() => {
    const target = frame.current;
    if (!target) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setVisible(true); observer.disconnect(); } });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);
  const onTileError = () => {
    if (retryTimer.current || mapFailed) return;
    if (attempt >= 1) { setMapFailed(true); return; }
    retryTimer.current = setTimeout(() => { retryTimer.current = null; setAttempt(value => value + 1); }, 500 * 2 ** attempt);
  };
  const map = visible && !mapFailed ? walk.mapPreview : null;
  const points = map?.points ?? walk.preview;
  const first = points?.[0], last = points?.at(-1);
  return <span className={styles.preview} ref={frame} aria-hidden="true">
    {points && first && last ? <svg className={`${styles.previewRoute} ${map ? styles.previewRouteMap : ""}`} viewBox={map ? "0 0 256 256" : "0 0 100 100"} preserveAspectRatio="xMidYMid meet">
      {map?.tiles.map(tile => <image key={`${attempt}-${tile.x}-${tile.y}`} href={tileUrl(map.zoom, tile.x, tile.y)} x={tile.left} y={tile.top} width="256" height="256" onError={onTileError} />)}
      <polyline points={points.map(([x, y]) => `${x},${y}`).join(" ")} />
      <circle className={styles.previewStart} cx={first[0]} cy={first[1]} r={map ? 9 : 5} />
      <circle className={styles.previewEnd} cx={last[0]} cy={last[1]} r={map ? 9 : 5} />
    </svg> : <span className={styles.previewFallback}>↗</span>}
  </span>;
}

function MetroMark({ station }: { station: MetroStation | null }) {
  const lines = station?.lines ?? [];
  return <span className={styles.metroLines} aria-hidden="true">{lines.length
    ? lines.map(line => <span key={line.id} className={styles.metroMark} title={line.name} style={{ backgroundColor: line.color, color: metroTextColor(line.color) }}>M</span>)
    : <span className={styles.metroMark}>M</span>}</span>;
}

/** Public ranking with server-side filters and 20-walk pages. */
export function TopWalks({ filterable = false }: { filterable?: boolean }) {
  const { locale, path, t } = useI18n();
  const [filters, setFilters] = useState<TopFilters>(emptyFilters);
  const [facets, setFacets] = useState<TopWalkPage["filters"]>({ starts: [], ends: [] });
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadJson(topWalksUrl(0, filters), controller.signal, validateTopWalkPage)
      .then(page => { if (!controller.signal.aborted) { setFacets(page.filters); setState({ status: "ready", ...page, more: "idle", moreError: "" }); } })
      .catch(caught => { if (!controller.signal.aborted) setState({ status: "error", message: toUserMessage(caught, "Не удалось загрузить топ прогулок.", locale) }); });
    return () => { controller.abort(); moreController.current?.abort(); moreController.current = null; };
  }, [filters, attempt, locale]);

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || state.nextOffset === null || state.more !== "idle" || moreController.current) return;
    const offset = state.nextOffset, controller = new AbortController();
    moreController.current = controller;
    setState(current => current.status === "ready" ? { ...current, more: "loading" } : current);
    loadJson(topWalksUrl(offset, filters), controller.signal, value => {
      const page = validateTopWalkPage(value);
      if (page.nextOffset !== null && page.nextOffset <= offset) throw new TypeError("Страница прогулок не продвинулась.");
      return page;
    }).then(page => {
      if (controller.signal.aborted) return;
      moreController.current = null;
      setState(current => {
        if (current.status !== "ready") return current;
        const seen = new Set(current.walks.map(walk => `${walk.kind}:${walk.id}`));
        const fresh = page.walks.filter(walk => !seen.has(`${walk.kind}:${walk.id}`));
        return { ...current, walks: [...current.walks, ...fresh], total: page.total, nextOffset: page.nextOffset, more: "idle", moreError: "" };
      });
    }).catch(caught => {
      if (controller.signal.aborted) return;
      moreController.current = null;
      setState(current => current.status === "ready" ? { ...current, more: "error", moreError: toUserMessage(caught, "Не удалось загрузить ещё прогулки.", locale) } : current);
    });
  }, [state, filters, locale]);

  useEffect(() => {
    if (state.status !== "ready" || state.nextOffset === null || state.more !== "idle" || !sentinel.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) loadMore(); });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [state, loadMore]);

  const selected = Boolean(filters.start || filters.end || filters.duration);
  const changeFilters = (patch: Partial<TopFilters>) => {
    const next = { ...filters, ...patch };
    if (next.start === filters.start && next.end === filters.end && next.duration === filters.duration) return;
    setState({ status: "loading" }); setFilters(next);
  };
  const reset = () => changeFilters(emptyFilters);
  const controls = filterable ? <div className={styles.filters} role="group" aria-label={t("Фильтры прогулок")}>
      <label className="ui-select-field">{t("Ближайшее метро к старту")}<select value={filters.start} onChange={event => changeFilters({ start: event.target.value })}><option value="">{t("Любая станция")}</option>{facets.starts.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="ui-select-field">{t("Ближайшее метро к финишу")}<select value={filters.end} onChange={event => changeFilters({ end: event.target.value })}><option value="">{t("Любая станция")}</option>{facets.ends.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className="ui-select-field">{t("Продолжительность")}<select value={filters.duration} onChange={event => changeFilters({ duration: event.target.value as TopDuration })}>
        <option value="">{t("Любая продолжительность")}</option><option value="up-to-30">{t("До 30 минут")}</option><option value="31-to-60">{t("31–60 минут")}</option><option value="61-to-90">{t("61–90 минут")}</option>
      </select></label>
      {selected ? <button type="button" className={styles.reset} onClick={reset}>{t("Сбросить фильтры")}</button> : null}
    </div> : null;
  if (state.status === "loading") return <>{controls}<p role="status" className="ui-muted">{t("Загружаем топ прогулок…")}</p></>;
  if (state.status === "error") return <>{controls}<p role="alert" className="ui-notice">{state.message}{" "}
    <button type="button" className={styles.retry} onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}>{t("Повторить")}</button></p></>;
  return <>
    {controls}
    {filterable && selected ? <p className={styles.resultCount} role="status">{t("Найдено: {count}", { count: state.total })}</p> : null}
    {state.walks.length ? <ol className={styles.list}>
      {state.walks.map(walk => <li key={`${walk.kind}:${walk.id}`} className={`${styles.item} ${styles.card}`}>
        <Link className={styles.cardOverlay} href={path(topWalkHref(walk))} aria-label={t("Подробнее о маршруте «{title}»", { title: walk.title })} />
          <span className={styles.body}>
            <span className={styles.heading}><span className={styles.rank}>{walk.rank}</span><strong className={styles.title}>{walk.title}</strong></span>
            <span className={styles.rating}>{formatRatingSummary(walk.rating, locale) || t("Пока без оценок")}</span>
            <span className={styles.meta}>{formatTopWalkMeta(walk, locale)}</span>
            {walk.startMetro || walk.endMetro ? <span className={styles.metro}>
              <span className={styles.metroRow}><MetroMark station={walk.startMetro} />{walk.startMetro ? t("Старт: м. {station}", { station: walk.startMetro.name }) : t("Старт: метро не указано")}</span>
              <span className={styles.metroRow}><MetroMark station={walk.endMetro} />{walk.endMetro ? t("Финиш: м. {station}", { station: walk.endMetro.name }) : t("Финиш: метро не указано")}</span>
            </span> : null}
          </span>
          <span className={styles.previewWrap}><RoutePreview walk={walk} />
            {walk.mapPreview ? <a className={styles.attribution} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap<br />contributors</a> : null}
          </span>
      </li>)}
    </ol> : <p className={styles.empty}>{selected ? t("По выбранным фильтрам прогулок нет.") : t("В топе пока пусто. Откройте свою прогулку всем — после проверки она появится здесь.")} {selected ? <button type="button" className={styles.retry} onClick={reset}>{t("Сбросить фильтры")}</button> : null}</p>}
    {state.total > 0 ? <p className={styles.resultCount} role="status" aria-live="polite">{t("Загружено: {loaded} из {total}", { loaded: state.walks.length, total: state.total })}</p> : null}
    {state.nextOffset !== null ? <div ref={sentinel} className={styles.loadMore}>
      {state.more === "error" ? <p role="alert">{state.moreError} <button type="button" className={styles.retry} onClick={() => setState(current => current.status === "ready" ? { ...current, more: "idle", moreError: "" } : current)}>{t("Повторить")}</button></p>
        : <button type="button" className={styles.moreButton} aria-disabled={state.more === "loading"} onClick={loadMore}>{state.more === "loading" ? t("Загружаем ещё прогулки…") : t("Загрузить ещё")}</button>}
    </div> : null}
  </>;
}
