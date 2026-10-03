"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toUserMessage } from "@/lib/errors/user-message";
import { ExploreIcon } from "../explore/icons";
import { ImprovementFields } from "../improvements/improvement-fields";
import { canonicalIssues, type ImprovementIssue } from "../improvements/model";
import { resolveReviewer, type Reviewer } from "../reviews/api";
import reviewStyles from "../reviews/walk-reviews.module.css";
import { loadPlaceFeedback, savePlaceFeedback } from "./api";
import { PLACE_FEEDBACK_TEXT_MAX, type PlaceFeedback as Feedback, type PlaceFeedbackInput, type PlaceRating } from "./model";
import styles from "./place-feedback.module.css";

/** Parent keys this component by place ID: drafts and requests never cross between places. */
export function PlaceFeedback({ placeId, title }: { placeId: string; title: string }) {
  const [loaded, setLoaded] = useState<{ reviewer: Reviewer; mine: Feedback | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ImprovementIssue[]>([]);
  const [text, setText] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const titleId = useId(), textId = useId();
  const lifetime = useRef<AbortController | null>(null);
  const writing = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void (async () => {
      try {
        const reviewer = await resolveReviewer();
        if (controller.signal.aborted) return;
        const result = await loadPlaceFeedback(placeId, reviewer, controller.signal);
        if (!controller.signal.aborted) { setLoaded({ reviewer, mine: result.mine }); setFailed(false); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
    })();
    return () => controller.abort();
  }, [placeId, attempt]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) { try { element.showModal(); } catch { element.setAttribute("open", ""); } }
    else if (!open && element.open) element.close();
  }, [open]);

  function improve(mine: Feedback | null) {
    setSelected(mine?.issues ?? []); setText(mine?.text ?? ""); setError(""); setOpen(true);
  }

  async function save(input: PlaceFeedbackInput, after: (mine: Feedback | null) => void) {
    const controller = lifetime.current;
    if (!loaded || writing.current || !controller || controller.signal.aborted) return;
    writing.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await savePlaceFeedback(placeId, loaded.reviewer, input, controller.signal);
      if (!controller.signal.aborted) { setLoaded({ ...loaded, mine: result.mine }); after(result.mine); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(toUserMessage(cause, "Не удалось сохранить оценку. Повторите попытку."));
    } finally {
      writing.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function rate(rating: PlaceRating, button: HTMLButtonElement) {
    opener.current = button;
    const next = loaded?.mine?.rating === rating ? null : rating;
    void save({ rating: next, issues: [], text: "" }, mine => {
      if (next === -1) improve(mine);
      else setNotice(next === 1 ? "Спасибо за оценку!" : "Оценка снята.");
    });
  }

  const issues = canonicalIssues(selected), cleanText = text.trim();
  const unchanged = issues.join() === (loaded?.mine?.issues ?? []).join() && cleanText === (loaded?.mine?.text ?? "");
  return <div className={styles.root}>
    <div className={styles.actions} role="group" aria-label="Оценка места">
      <button type="button" disabled={!loaded || busy} aria-pressed={loaded?.mine?.rating === 1} onClick={event => rate(1, event.currentTarget)}><ExploreIcon name="thumbUp" />Нравится</button>
      <button type="button" disabled={!loaded || busy} aria-pressed={loaded?.mine?.rating === -1} onClick={event => rate(-1, event.currentTarget)}><ExploreIcon name="thumbDown" />Не нравится</button>
    </div>
    {loaded?.mine?.rating === -1 ? <button type="button" className={styles.explain} disabled={busy} onClick={event => { opener.current = event.currentTarget; improve(loaded.mine); }}>Что можно улучшить?</button> : null}
    {failed ? <p className={styles.message} role="alert">Не удалось загрузить оценку. <button type="button" className={styles.explain} onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Повторить</button></p> : null}
    {!loaded && !failed ? <p className={styles.message} role="status">Загружаем оценку…</p> : null}
    {notice ? <p className={styles.message} role="status">{notice}</p> : null}
    {error && !open ? <p className={reviewStyles.error} role="alert">{error}</p> : null}
    <dialog ref={dialog} className={reviewStyles.dialog} aria-labelledby={titleId} onClose={() => { setOpen(false); opener.current?.focus(); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setOpen(false);
    }}>
      <header className={reviewStyles.dialogHeader}><div><h2 id={titleId}>Что улучшить в этом месте?</h2><p>{title}</p></div>
        <button type="button" className={reviewStyles.close} aria-label="Закрыть" onClick={() => setOpen(false)}><ExploreIcon name="close" /></button>
      </header>
      {open ? <form className={reviewStyles.form} onSubmit={event => {
        event.preventDefault();
        if (unchanged || (!issues.length && !cleanText && !loaded?.mine?.text && !loaded?.mine?.issues.length)) return;
        void save({ rating: -1, issues, text: cleanText }, () => { setOpen(false); setNotice("Спасибо! Передали редакции, что можно улучшить."); });
      }}>
        <ImprovementFields selected={selected} busy={busy} onChange={setSelected} />
        <label className={styles.comment} htmlFor={textId}>Ваш комментарий <span>(необязательно)</span>
          <textarea id={textId} rows={3} maxLength={PLACE_FEEDBACK_TEXT_MAX} value={text} disabled={busy} onChange={event => setText(event.target.value)} />
          <span>{text.length} / {PLACE_FEEDBACK_TEXT_MAX}</span>
        </label>
        <p className={reviewStyles.hint}>Можно выбрать причину или написать своими словами. Дизлайк уже сохранён.</p>
        {error ? <p className={reviewStyles.error} role="alert">{error}</p> : null}
        <button type="submit" className={reviewStyles.primary} disabled={busy || unchanged}>{busy ? "Отправляем…" : "Отправить"}</button>
      </form> : null}
    </dialog>
  </div>;
}
