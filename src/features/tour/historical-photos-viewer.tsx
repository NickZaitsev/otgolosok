"use client";

import { useId, useRef, useState } from "react";
import { ExploreIcon } from "../explore/icons";
import viewerStyles from "../explore/place-photo.module.css";
import { useI18n } from "@/lib/i18n/provider";
import { historicalWalkPhotos } from "./historical-photos";
import styles from "./historical-photos.module.css";

/**
 * «Исторические снимки» of a stop: a button in the walk tools that opens a viewer right in the walk, a photo at a time.
 * Not a strip of thumbnails: the walk card has no room to scroll, and a strip in the photo slot squeezed the stop
 * photo to a sliver. The title and the PastVu link live in the viewer, next to the full photo.
 */
export function HistoricalPhotos({ walkId, stopId }: { walkId: string; stopId: string }) {
  const { t } = useI18n();
  const photos = historicalWalkPhotos(walkId, stopId);
  const [selected, setSelected] = useState<number | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [openFailed, setOpenFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogTitle = useId();
  if (!photos.length) return null;

  const alt = (index: number) => t("{title}, {year} год", { title: photos[index].title, year: photos[index].year });
  function show(index: number) {
    try {
      dialog.current?.showModal();
      setSelected(index);
      setImageFailed(false);
      setOpenFailed(false);
      closeButton.current?.focus();
    } catch {
      setOpenFailed(true);
    }
  }
  function change(step: number) {
    setSelected(index => index === null ? index : Math.max(0, Math.min(photos.length - 1, index + step)));
    setImageFailed(false);
  }
  const current = selected === null ? null : photos[selected];

  return <>
    <button ref={trigger} type="button" aria-haspopup="dialog" onClick={() => show(0)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 8"/></svg>
      {t("Исторические снимки · {count}", { count: photos.length })}
    </button>
    {openFailed ? <p className={styles.status} role="status">{t("Не удалось открыть фотографию. Попробуйте ещё раз.")}</p> : null}
    <dialog ref={dialog} className={viewerStyles.viewer} aria-labelledby={dialogTitle}
      onClose={() => { setSelected(null); trigger.current?.focus({ preventScroll: true }); }}
      onClick={event => {
        // A click on the backdrop lands on the dialog element itself, outside its box.
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
      }}>
      <header className={viewerStyles.viewerHeader}>
        <h3 id={dialogTitle} lang="ru">{current ? `${current.year} · ${current.title}` : ""}</h3>
        <button ref={closeButton} type="button" className={viewerStyles.close} aria-label={t("Закрыть фото")} onClick={() => dialog.current?.close()}><ExploreIcon name="close" /></button>
      </header>
      <div className={viewerStyles.slider}>
        {current && selected !== null ? imageFailed ? <div className={viewerStyles.error} role="status">
          <p>{t("Фотография не загрузилась. Проверьте подключение и попробуйте ещё раз.")}</p>
          <button type="button" onClick={() => { setAttempt(value => value + 1); setImageFailed(false); }}>{t("Повторить")}</button>
        </div> : <>
          {/* eslint-disable-next-line @next/next/no-img-element -- размеры снимков PastVu неизвестны, а оптимизатор Next в статической сборке не работает. */}
          <img key={`${current.cid}:${attempt}`} className={viewerStyles.full} src={current.src} alt={alt(selected)} onError={() => setImageFailed(true)} />
        </> : null}
        {photos.length > 1 && selected !== null ? <>
          <button type="button" className={`${viewerStyles.previewArrow} ${viewerStyles.previous}`} disabled={selected === 0}
            aria-label={t("Предыдущее фото")} onClick={() => change(-1)}><ExploreIcon name="arrow" /></button>
          <button type="button" className={`${viewerStyles.previewArrow} ${viewerStyles.next}`} disabled={selected === photos.length - 1}
            aria-label={t("Следующее фото")} onClick={() => change(1)}><ExploreIcon name="arrow" /></button>
          <span className={viewerStyles.count} role="status">{t("Фото {current} из {total}", { current: selected + 1, total: photos.length })}</span>
        </> : null}
      </div>
      {current ? <p className={viewerStyles.credit}><a href={`https://pastvu.com/p/${current.cid}`} target="_blank" rel="noopener noreferrer">{t("Открыть на PastVu")}</a></p> : null}
    </dialog>
  </>;
}
