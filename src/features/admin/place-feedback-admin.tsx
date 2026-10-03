"use client";

import { useState } from "react";
import { improvementIssueLabels } from "../improvements/model";
import type { PlaceFeedback } from "../place-feedback/model";
import { pageCount, pageRange, type AdminApi, type AdminRun } from "./model";
import styles from "./reviews-admin.module.css";

type Item = PlaceFeedback & { id: string; place: { id: string; title: string } };
type Page = { items: Item[]; total: number; offset: number; hasMore: boolean };

/** Та же редакционная очередь улучшений, с привязкой к месту и приватным комментарием. */
export function PlaceFeedbackAdmin({ api, run, busy }: { api: AdminApi; run: AdminRun; busy: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const disabled = Boolean(busy);
  async function load(offset: number, signal: AbortSignal) {
    setFailed(false);
    try { setPage(await api<Page>(`/place-feedback?limit=25&offset=${offset}`, signal)); }
    catch (error) { setFailed(true); throw error; }
  }
  return <section className="walk-admin" aria-labelledby="place-feedback-admin-title">
    <div className="walk-admin__head"><div><h2 id="place-feedback-admin-title">Что улучшить в местах</h2><p>Дизлайки, выбранные причины и комментарии зрителей. Комментарии видны только редакции.</p></div>
      <button type="button" disabled={disabled} onClick={() => void run("Загрузка оценок мест…", signal => load(page?.offset ?? 0, signal))}>{failed ? "Повторить загрузку оценок мест" : page ? "Обновить оценки мест" : "Показать оценки мест"}</button>
    </div>
    {failed ? <p className="walk-admin__message walk-admin__message--error" role="alert">Не удалось загрузить оценки мест.</p> : null}
    {notice ? <p className="walk-admin__message" role="status">{notice}</p> : null}
    {page ? <>
      <p className="admin-meta" role="status">Показано {pageRange(page.offset, page.items.length, page.total)} запросов.</p>
      <div className="walk-admin__table-wrap" role="region" aria-label="Запросы на улучшение мест" tabIndex={0}>
        <table className={`walk-admin__table ${styles.table}`}><caption className="admin-sr-only">Причины дизлайков и комментарии к местам</caption>
          <thead><tr><th scope="col">Место</th><th scope="col">Что улучшить</th><th scope="col">Комментарий</th><th scope="col">Дата</th><th scope="col">Действия</th></tr></thead>
          <tbody>{page.items.map(item => <tr key={item.id}>
            <th scope="row">{item.place.title}<span className={styles.meta}>{item.place.id}</span></th>
            <td>{item.issues.map(issue => improvementIssueLabels[issue]).join("; ") || "Причина не указана"}</td>
            <td><p className={styles.text}>{item.text || "—"}</p></td>
            <td><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString("ru-RU")}</time></td>
            <td><button type="button" disabled={disabled} onClick={() => void run("Закрытие запроса к месту…", async signal => {
              await api("/place-feedback/resolve", signal, { id: item.id });
              setNotice(`Запрос к месту «${item.place.title}» отмечен решённым.`);
              await load(page.offset, signal);
            })}>Отметить решённым</button></td>
          </tr>)}</tbody>
        </table>
        {!page.total ? <p className="walk-admin__empty">Открытых запросов к местам нет.</p> : null}
      </div>
      <nav className="admin-pagination" aria-label="Страницы оценок мест">
        <button type="button" disabled={disabled || !page.offset} onClick={() => void run("Загрузка оценок мест…", signal => load(Math.max(0, page.offset - 25), signal))}>Назад</button>
        <span className="admin-meta">Страница {Math.floor(page.offset / 25) + 1} из {pageCount(page.total, 25)}</span>
        <button type="button" disabled={disabled || !page.hasMore} onClick={() => void run("Загрузка оценок мест…", signal => load(page.offset + 25, signal))}>Далее</button>
      </nav>
    </> : null}
  </section>;
}
