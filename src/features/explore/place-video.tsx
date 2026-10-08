"use client";

import { useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { pauseAudioElement } from "@/lib/audio/audio-element";
import videos from "./place-videos.json";
import { ExploreIcon } from "./icons";
import photoStyles from "./place-photo.module.css";
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
  const headingId = useId();
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
      <button ref={trigger} type="button" className={styles.trigger} data-video-trigger onClick={show} aria-haspopup="dialog">{t("Смотреть видео")}</button>
      <span className={styles.duration}>{durationLabel} · YouTube</span>
    </div>
    {openFailed ? <p role="alert">{t("Не удалось открыть видео.")} {link}</p> : null}
    <dialog ref={dialog} className={`${photoStyles.viewer} ${styles.viewer}`} aria-labelledby={headingId} data-video-dialog
      onClose={() => { setOpen(false); trigger.current?.focus({preventScroll:true}); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
      }}>
      <header className={photoStyles.viewerHeader}>
        <h3 id={headingId}>{t("Видео: {title}", {title})}</h3>
        <button ref={close} type="button" className={photoStyles.close} aria-label={t("Закрыть видео")} onClick={() => dialog.current?.close()}><ExploreIcon name="close" /></button>
      </header>
      {open ? frameFailed ? <div role="alert">
        <p>{t("Не удалось загрузить видео.")}</p>
        <button type="button" className={styles.trigger} onClick={() => {setAttempt(value => value + 1); setFrameFailed(false);}}>{t("Повторить загрузку видео")}</button>
      </div> : <div className={styles.player}>
        <iframe key={attempt} src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?playsinline=1&rel=0`}
          title={t("Видео: {title}", {title})} referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen
          onErrorCapture={() => setFrameFailed(true)} />
      </div> : null}
      <p className={styles.fallback}>{link}</p>
    </dialog>
  </div>;
}
