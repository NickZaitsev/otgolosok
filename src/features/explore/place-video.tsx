"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { pauseAudioElement } from "@/lib/audio/audio-element";
import videos from "./place-videos.json";
import { ExploreIcon } from "./icons";
import styles from "./place-video.module.css";

/** Без внешних запросов до явного нажатия; закрытие уничтожает iframe и останавливает ролик. */
export function PlaceVideo({ placeId, title, compact = false }: { placeId?: string; title: string; compact?: boolean }) {
  const { t } = useI18n();
  const video = placeId ? (videos as Record<string, {youtubeId: string; durationSeconds: number; privacy: string}>)[placeId] : undefined;
  const [open, setOpen] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  if (!video || !/^[A-Za-z0-9_-]{11}$/.test(video.youtubeId) || video.privacy !== "unlisted" || !Number.isFinite(video.durationSeconds) || video.durationSeconds <= 0) return null;
  const watchUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;
  const duration = Math.floor(video.durationSeconds);
  const durationLabel = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`;
  function show() {
    try {
      dialog.current?.showModal();
      document.querySelectorAll<HTMLAudioElement>("audio").forEach(pauseAudioElement);
      setOpen(true); setOpenFailed(false); setFrameFailed(false);
      close.current?.focus();
    } catch {
      dialog.current?.close(); setOpenFailed(true);
    }
  }
  const link = <a href={watchUrl} target="_blank" rel="noopener noreferrer">{t("Открыть на YouTube")}</a>;
  return <div className={`${styles.video}${compact ? ` ${styles.compact}` : ""}`} data-place-video>
    <div className={styles.actions}>
      <button ref={trigger} type="button" className={styles.trigger} data-video-trigger onClick={show} aria-haspopup="dialog">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="12" height="14" rx="2"/><path d="m15 9 6-4v14l-6-4z"/></svg>
        <span>{t("Смотреть видео")}</span>
      </button>
      <span className={styles.duration}>{durationLabel} · YouTube</span>
    </div>
    {openFailed ? <p role="alert">{t("Не удалось открыть видео.")} {link}</p> : null}
    <dialog ref={dialog} className={styles.viewer} aria-label={t("Видео: {title}", {title})} data-video-dialog
      onClose={() => { setOpen(false); trigger.current?.focus({preventScroll:true}); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
      }}>
      <header className={styles.header}>
        <a className={styles.control} href={watchUrl} target="_blank" rel="noopener noreferrer" aria-label={t("Открыть на YouTube")} title={t("Открыть на YouTube")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3h7v7M21 3 10 14M21 14v7H3V3h7"/></svg>
        </a>
        <button ref={close} type="button" className={styles.control} aria-label={t("Закрыть видео")} onClick={() => dialog.current?.close()}><ExploreIcon name="close" /></button>
      </header>
      {open ? frameFailed ? <div className={styles.error} role="alert">
        <p>{t("Не удалось загрузить видео.")}</p>
        <button type="button" className={styles.trigger} onClick={() => {setAttempt(value => value + 1); setFrameFailed(false);}}>{t("Повторить загрузку видео")}</button>
      </div> : <div className={styles.player}>
        <iframe key={attempt} src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?playsinline=1&rel=0&controls=0&iv_load_policy=3&autoplay=1`}
          title={t("Видео: {title}", {title})} referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen
          onErrorCapture={() => setFrameFailed(true)} />
      </div> : null}
    </dialog>
  </div>;
}
