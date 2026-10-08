"use client";

import Image from "next/image";
import { useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ExploreIcon } from "./icons";
import type { PlacePhoto } from "./place-story";
import { placePhotoGallery } from "./place-photo-gallery";
import styles from "./place-photo.module.css";
import { useI18n } from "@/lib/i18n/provider";

export type { PlacePhoto };

/** The tallest width-to-height ratio of the photo in the expanded story card: a little taller than a square. */
export const TALLEST_RATIO = 4 / 5;

/**
 * The wide photo on top of a place card, as in map apps; a tap opens the full image with its credit.
 * The caller keys it by place so loading failures cannot leak into the next card. `pending` holds an
 * empty banner while the photo of a place known to have one is loading, so the card never jumps.
 * Renders nothing without a photo or after the banner image fails.
 * With `onPreview` the banner is only a picture: a tap calls it (the story card expands) instead of opening the
 * viewer, and it is no separate control, since keyboard users have the card's own handle.
 */
export function PlacePhotoBanner({ photo: suppliedPhoto, placeId, pending = false, title, onPreview }: { photo?: PlacePhoto; placeId?: string; pending?: boolean; title: string; onPreview?: () => void }) {
  const { locale, t } = useI18n();
  const photos = placePhotoGallery(placeId, suppliedPhoto);
  const [bannerIndex, setBannerIndex] = useState(0);
  const photo = photos[bannerIndex];
  const [selected, setSelected] = useState(0);
  const currentPhoto = photos[selected] ?? photo;
  const [bannerFailed, setBannerFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [openFailed, setOpenFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialogTitle = useId();
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  // Static on purpose: no shimmer, so it is safe with reduced motion.
  if (!photo && pending) return <span aria-hidden="true" className={styles.placeholder} data-photo-placeholder />;
  if (!photo || bannerFailed) return null;
  const image = <Image unoptimized src={photo.src} width={photo.width} height={photo.height} alt={photo.alt}
    draggable={false} loading="eager" onError={() => { if (bannerIndex + 1 < photos.length) setBannerIndex(index => index + 1); else setBannerFailed(true); }} />;
  // The expanded story shows the photo whole, but a tall one no taller than 4:5: the text must stay in sight.
  const ratio = { "--photo-ratio": Math.max(photo.width / photo.height, TALLEST_RATIO) } as CSSProperties;
  const count = photos.length > 1 ? <span className={styles.count}>{t("Фото {current} из {total}", { current: bannerIndex + 1, total: photos.length })}</span> : null;
  const arrows = photos.length > 1 ? <>
    <button type="button" className={`${styles.previewArrow} ${styles.previous}`} disabled={bannerIndex === 0}
      aria-label={t("Предыдущее фото")} onClick={() => setBannerIndex(index => index - 1)}><ExploreIcon name="arrow" /></button>
    <button type="button" className={`${styles.previewArrow} ${styles.next}`} disabled={bannerIndex === photos.length - 1}
      aria-label={t("Следующее фото")} onClick={() => setBannerIndex(index => index + 1)}><ExploreIcon name="arrow" /></button>
  </> : null;
  function swipeStart(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (photos.length < 2 || !event.isPrimary || event.button !== 0 || (event.target as Element).closest("button:not([data-photo-banner]), a")) return;
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  const frame = { className: styles.frame, style: ratio,
    onPointerDown: swipeStart,
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const start = swipe.current;
      if (!start || start.id !== event.pointerId) return;
      if (Math.abs(event.clientX - start.x) > 10 && Math.abs(event.clientX - start.x) > Math.abs(event.clientY - start.y) * 1.5) {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Захват может закончиться вместе с указателем; жест в пределах фото продолжает работать. */ }
      }
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const start = swipe.current; swipe.current = null;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(event.clientY - start.y) * 1.5) return;
      setBannerIndex(index => Math.max(0, Math.min(photos.length - 1, index + (dx < 0 ? 1 : -1))));
      suppressClick.current = true;
    },
    onPointerCancel: () => { swipe.current = null; suppressClick.current = false; },
    onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
      if (!suppressClick.current) return;
      suppressClick.current = false; event.preventDefault(); event.stopPropagation();
    },
  };
  if (onPreview) return <div {...frame}><span className={`${styles.banner} ${styles.preview}`} onClick={onPreview} data-photo-banner>{image}{count}</span>{arrows}</div>;

  function showPhoto() {
    try {
      dialog.current?.showModal();
      setOpen(true);
      setSelected(bannerIndex);
      setImageFailed(false);
      setOpenFailed(false);
      closeButton.current?.focus();
    } catch {
      setOpenFailed(true);
    }
  }

  return <>
    <div {...frame}><button ref={trigger} type="button" className={styles.banner} onClick={showPhoto} data-photo-banner
      aria-label={t("Открыть фото: {title}", { title })} aria-haspopup="dialog">
      {/* The full copy: the 250 px preview would be blurry stretched across the card, and the viewer then opens from cache. */}
      {image}
      {count}
    </button>{arrows}</div>
    {openFailed ? <p className={styles.status} role="status">{t("Не удалось открыть фотографию. Попробуйте ещё раз.")}</p> : null}
    <dialog ref={dialog} className={styles.viewer} aria-labelledby={dialogTitle}
      onClose={() => { setOpen(false); setBannerIndex(selected); trigger.current?.focus({ preventScroll: true }); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
      }}>
      <header className={styles.viewerHeader}>
        <h3 id={dialogTitle} lang={locale === "ru" ? undefined : "ru"}>{title}</h3>
        <button ref={closeButton} type="button" className={styles.close} aria-label={t("Закрыть фото")} onClick={() => dialog.current?.close()}><ExploreIcon name="close" /></button>
      </header>
      {photos.length > 1 ? <nav className={styles.navigation} aria-label={t("Фотографии места")}>
        <button type="button" disabled={selected === 0} onClick={() => { setSelected(index => index - 1); setImageFailed(false); }}>{t("Предыдущее фото")}</button>
        <span role="status">{t("Фото {current} из {total}", { current: selected + 1, total: photos.length })}</span>
        <button type="button" disabled={selected === photos.length - 1} onClick={() => { setSelected(index => index + 1); setImageFailed(false); }}>{t("Следующее фото")}</button>
      </nav> : null}
      {open ? imageFailed ? <div className={styles.error} role="status">
        <p>{t("Фотография не загрузилась. Проверьте подключение и попробуйте ещё раз.")}</p>
        <button type="button" onClick={() => { setAttempt(value => value + 1); setImageFailed(false); }}>{t("Повторить")}</button>
      </div> : <Image key={`${selected}:${attempt}`} unoptimized src={currentPhoto.src} width={currentPhoto.width} height={currentPhoto.height}
        loading="eager" alt={currentPhoto.alt} className={styles.full} onError={() => setImageFailed(true)} /> : null}
      <p className={styles.caption} lang="ru">{currentPhoto.alt}</p>
      <p className={styles.credit}>{t("Фото:")} {currentPhoto.author ? `${currentPhoto.author}. ` : null}<a href={currentPhoto.sourceUrl} target="_blank" rel="noopener noreferrer">Wikimedia Commons</a> · <a href={currentPhoto.licenseUrl} target="_blank" rel="noopener noreferrer">{currentPhoto.license}</a></p>
    </dialog>
  </>;
}
