"use client";

import { useEffect, useRef, useState } from "react";
import { IMPROVEMENT_ISSUES, type ImprovementIssue } from "../improvements/model";
import { pageCount, pageRange, type AdminApi, type AdminRun } from "./model";
import { PlaceFeedbackAdmin } from "./place-feedback-admin";
import { skeletonRows } from "./table-skeleton";
import styles from "./reviews-admin.module.css";

type Status = "open" | "resolved" | "all";
type WalkImprovements = {
  walk: { kind: "catalog" | "account"; id: string; title: string; url: string | null };
  total: number; open: number; lastAt: string; issues: Record<ImprovementIssue, number>;
};
type ImprovementPage = { walks: WalkImprovements[]; total: number; offset: number; hasMore: boolean; open: number };
type Filters = { status: Status; issue: ImprovementIssue | ""; q: string };
const EMPTY_FILTERS: Filters = { status: "open", issue: "", q: "" };
const PAGE_SIZE = 25;
/** Short column labels; the walker sees the longer wording of the same three options. */
const issueLabels: Record<ImprovementIssue, string> = { short_text: "Мало информации", no_images: "Нет превью", voiceover: "Озвучка" };
const dateLabel = (value: string) => new Date(value).toLocaleString("ru-RU");

/** Improvement requests grouped by walk: what walkers miss, and how many of them. */
export function ImprovementsAdmin({ api, run, busy }: { api: AdminApi; run: AdminRun; busy: string }) {
  const loaded = useRef(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState<ImprovementPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState("");

  async function load(next: Filters, offset: number, signal: AbortSignal) {
    setLoading(true); setFailed(false);
    try {
      const params = new URLSearchParams({ status: next.status, ...(next.issue ? { issue: next.issue } : {}), ...(next.q ? { q: next.q } : {}), limit: String(PAGE_SIZE), offset: String(offset) });
      setPage(await api<ImprovementPage>(`/improvements?${params}`, signal)); setApplied(next);
    } catch (error) { setFailed(true); throw error; }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (busy || loaded.current) return;
    void run("Загрузка запросов…", async signal => {
      loaded.current = true;
      await load(EMPTY_FILTERS, 0, signal);
    });
    // The initial request runs once after the parent releases its authentication request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, busy, run]);

  function resolve(item: WalkImprovements) {
    setNotice("");
    void run("Закрытие запросов…", async signal => {
      const { resolved } = await api<{ resolved: number }>("/improvements/resolve", signal, { kind: item.walk.kind, id: item.walk.id });
      setNotice(resolved ? `Запросы к прогулке «${item.walk.title}» отмечены решёнными.` : "Открытых запросов к этой прогулке уже нет.");
      await load(applied, page?.offset ?? 0, signal);
    });
  }

  const disabled = Boolean(busy) || loading;
  const hasFilters = applied.status !== "open" || Boolean(applied.issue || applied.q);
  return <><section className="walk-admin" aria-busy={loading} aria-labelledby="improvements-admin-title">
    <div className="walk-admin__head">
      <div><h2 id="improvements-admin-title">Запросы на улучшение</h2><p>{page ? `Открытых запросов: ${page.open}` : "Что зрители просят улучшить в прогулках."}</p></div>
      <button type="button" disabled={disabled} onClick={() => void run("Обновление запросов…", signal => load(applied, page?.offset ?? 0, signal))}>Обновить список</button>
    </div>
    <form className={styles.filters} onSubmit={event => {
      event.preventDefault();
      setNotice("");
      void run("Поиск запросов…", signal => load({ ...filters, q: filters.q.trim() }, 0, signal));
    }}>
      <label>Статус<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value as Status })}>
        <option value="open">Открытые</option><option value="resolved">Решённые</option><option value="all">Все</option>
      </select></label>
      <label>Причина<select value={filters.issue} onChange={event => setFilters({ ...filters, issue: event.target.value as Filters["issue"] })}>
        <option value="">Любая</option>{IMPROVEMENT_ISSUES.map(issue => <option key={issue} value={issue}>{issueLabels[issue]}</option>)}
      </select></label>
      <label>Название прогулки<input type="search" maxLength={120} value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} /></label>
      <button type="submit" className="admin-primary" disabled={disabled}>Найти</button>
      <button type="button" disabled={disabled || (!hasFilters && filters.status === "open" && !filters.issue && !filters.q)} onClick={() => {
        setFilters(EMPTY_FILTERS); setNotice("");
        void run("Сброс фильтров…", signal => load(EMPTY_FILTERS, 0, signal));
      }}>Сбросить</button>
    </form>
    {notice && <p className="walk-admin__message" role="status">{notice}</p>}
    {failed && <p className="walk-admin__message walk-admin__message--error" role="alert">Не удалось загрузить запросы. {page ? "Показаны ранее загруженные данные. " : ""}<button type="button" disabled={disabled} onClick={() => void run("Повторная загрузка…", signal => load(applied, page?.offset ?? 0, signal))}>Повторить</button></p>}
    <p className="admin-meta" role="status">{loading ? "Загружаем запросы…" : page ? `Показано ${pageRange(page.offset, page.walks.length, page.total)} прогулок.` : ""}</p>
    <div className="walk-admin__table-wrap" role="region" aria-label="Запросы на улучшение по прогулкам" tabIndex={0}>
      <table className={`walk-admin__table ${styles.table}`}>
        <caption className="admin-sr-only">Число запросов на улучшение по прогулкам и причинам</caption>
        <thead><tr><th scope="col">Прогулка</th><th scope="col">Всего</th>{IMPROVEMENT_ISSUES.map(issue => <th key={issue} scope="col">{issueLabels[issue]}</th>)}<th scope="col">Последний</th><th scope="col">Действия</th></tr></thead>
        <tbody>{loading ? skeletonRows(7, page?.walks.length ?? 0) : page?.walks.map(item => <tr key={`${item.walk.kind}:${item.walk.id}`}>
          <th scope="row">{item.walk.url ? <a href={item.walk.url} target="_blank" rel="noopener noreferrer">{item.walk.title}</a> : item.walk.title}
            <span className={styles.meta}>{item.walk.kind === "catalog" ? "Каталог" : "Прогулка пользователя"}{item.walk.url ? "" : " · удалена или закрыта"}</span></th>
          <td>{item.total}</td>
          {IMPROVEMENT_ISSUES.map(issue => <td key={issue}>{item.issues[issue] || "—"}</td>)}
          <td><time dateTime={item.lastAt}>{dateLabel(item.lastAt)}</time></td>
          <td>{item.open ? <button type="button" disabled={disabled} onClick={() => resolve(item)}>Отметить решёнными</button> : <span className={styles.meta}>Решены</span>}</td>
        </tr>)}</tbody>
      </table>
      {page && !page.total && !loading && !failed && <p className="walk-admin__empty">{hasFilters ? "По этим фильтрам запросов нет. Измените условия или сбросьте фильтры." : "Открытых запросов на улучшение нет."}</p>}
    </div>
    {page && <nav className="admin-pagination" aria-label="Страницы запросов">
      <button type="button" disabled={disabled || page.offset === 0} onClick={() => void run("Загрузка запросов…", signal => load(applied, Math.max(0, page.offset - PAGE_SIZE), signal))}>Назад</button>
      <span className="admin-meta">Страница {Math.floor(page.offset / PAGE_SIZE) + 1} из {pageCount(page.total, PAGE_SIZE)}</span>
      <button type="button" disabled={disabled || !page.hasMore} onClick={() => void run("Загрузка запросов…", signal => load(applied, page.offset + PAGE_SIZE, signal))}>Далее</button>
    </nav>}
  </section><PlaceFeedbackAdmin api={api} run={run} busy={busy} /></>;
}
