"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toUserMessage } from "@/lib/errors/user-message";
import { ExploreIcon } from "../explore/icons";
import { resolveReviewer, type Reviewer } from "../reviews/api";
import { targetKey, type ReviewTarget } from "../reviews/model";
import reviewStyles from "../reviews/walk-reviews.module.css";
import { loadImprovement, saveImprovement } from "./api";
import { canonicalIssues, type ImprovementIssue, type MyImprovement } from "./model";
import { ImprovementFields } from "./improvement-fields";

/** How long the thank-you message stays before the window closes itself. */
export const IMPROVEMENT_SENT_CLOSE_MS = 3000;

type Loaded = { reviewer: Reviewer; mine: MyImprovement | null };

/**
 * «Что улучшить?»: the viewer ticks what is wrong with the walk, and the editors see it.
 * One request per viewer and walk; sending again replaces it, unticking everything withdraws it.
 */
export function ImprovementDialog({ target, open, onClose, walkTitle }: { target: ReviewTarget; open: boolean; onClose: () => void; walkTitle: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<ImprovementIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [openedWith, setOpenedWith] = useState(false);
  if (openedWith !== open) {
    setOpenedWith(open);
    if (open) { setLoaded(null); setLoadFailed(false); setError(""); setSent(null); }
  }
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const mounted = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    mounted.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      // Browsers without modal dialogs still show the form, just without the backdrop.
      try { element.showModal(); } catch { element.setAttribute("open", ""); }
    } else if (!open && element.open) element.close();
  }, [open]);

  // The target object may be recreated on every render; only its key restarts loading.
  const key = targetKey(target);
  const targetRef = useRef(target);
  useEffect(() => { targetRef.current = target; });

  // Every opening reads the stored request afresh: it may have been changed on another device.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      const reviewer = await resolveReviewer();
      if (controller.signal.aborted) return;
      try {
        const { mine } = await loadImprovement(targetRef.current, reviewer, controller.signal);
        setLoaded({ reviewer, mine }); setSelected(mine?.issues ?? []);
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true);
      }
    })();
    return () => controller.abort();
  }, [open, key, attempt]);

  useEffect(() => {
    if (!open || sent === null) return;
    const timer = setTimeout(() => closeRef.current(), IMPROVEMENT_SENT_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, sent]);

  const mine = loaded?.mine ?? null;
  const issues = canonicalIssues(selected);
  const unchanged = mine?.status === "open" && issues.join() === mine.issues.join();
  const withdraw = !issues.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!loaded || busy || unchanged || (withdraw && !mine)) return;
    setBusy(true); setError("");
    try {
      const result = await saveImprovement(targetRef.current, loaded.reviewer, issues, mounted.current.signal);
      setLoaded({ ...loaded, mine: result.mine });
      setSent(result.mine ? "Спасибо! Передали редакции — постараемся улучшить прогулку." : "Запрос отозван.");
    } catch (cause) {
      setError(toUserMessage(cause, "Не удалось отправить запрос. Повторите попытку."));
    } finally {
      if (!mounted.current.signal.aborted) setBusy(false);
    }
  }

  return <dialog ref={dialog} className={reviewStyles.dialog} aria-labelledby={titleId} onClose={onClose}
    onClick={event => {
      // A click on the backdrop lands on the dialog element itself, outside its box.
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className={reviewStyles.dialogHeader}>
      <div>
        <h2 id={titleId}>Что улучшить в прогулке?</h2>
        <p>{walkTitle}</p>
      </div>
      <button type="button" className={reviewStyles.close} aria-label="Закрыть" onClick={onClose}><ExploreIcon name="close" /></button>
    </header>
    {!open ? null : sent !== null ? <p className={reviewStyles.sent} role="status">{sent}</p>
      : loadFailed ? <div className={reviewStyles.root}>
        <p className={reviewStyles.message} role="status">Не удалось загрузить форму.</p>
        <button type="button" className={reviewStyles.secondary} onClick={() => { setLoadFailed(false); setAttempt(value => value + 1); }}>Повторить</button>
      </div> : !loaded ? <p className={reviewStyles.message} role="status">Загружаем…</p>
      : <form className={reviewStyles.form} onSubmit={event => void submit(event)} aria-labelledby={titleId}>
        {mine?.status === "resolved" ? <p className={reviewStyles.message}>Редакция уже поработала над вашим прошлым запросом. Если проблема осталась, отправьте его снова.</p> : null}
        <ImprovementFields selected={selected} busy={busy} onChange={setSelected} />
        {mine?.status === "open" ? <p className={reviewStyles.hint}>Ваш запрос уже у редакции. Измените отметки или снимите все, чтобы отозвать его.</p> : null}
        {error ? <p className={reviewStyles.error} role="alert">{error}</p> : null}
        <button type="submit" className={reviewStyles.primary} disabled={busy || unchanged || (withdraw && !mine)}>
          {busy ? "Отправляем…" : error ? "Повторить" : withdraw && mine ? "Отозвать запрос" : mine?.status === "open" ? "Сохранить изменения" : "Отправить"}
        </button>
      </form>}
  </dialog>;
}
