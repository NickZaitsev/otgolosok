"use client";

import { useEffect, useState } from "react";
import { toUserMessage } from "@/lib/errors/user-message";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";
import type { WalkView } from "../walks/model";
import { loadOfflineWalk, removeOfflineWalk, saveWalkOffline, type OfflineWalkRef } from "../walks/offline";

export type OfflineCopy = {
  /** Number of recordings in the saved copy; null while there is none. */
  saved: number | null;
  message: string;
  busy: boolean;
  save: () => Promise<void>;
  remove: () => Promise<void>;
};

/** State of the walk's offline copy; lives with the walk so a closed settings panel keeps a running save. */
export function useOfflineCopy(view: WalkView | undefined, ref: OfflineWalkRef | null): OfflineCopy {
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    loadOfflineWalk(ref).then(
      copy => { if (!cancelled) setSaved(copy ? copy.manifest.audio.length : null); },
      () => { /* Without Cache Storage there is no saved copy to show. */ },
    );
    return () => { cancelled = true; };
  }, [ref]);

  async function save() {
    if (!view || !ref || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await saveWalkOffline(view, ref);
      setSaved(result.availableAudio);
      if (result.foodWarning) setMessage(t("Заведения не сохранены"));
    } catch (caught) {
      setMessage(toUserMessage(caught, "Не удалось сохранить офлайн-копию.", locale));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!ref || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await removeOfflineWalk(ref);
      setSaved(null);
    } catch {
      setMessage(t("Не удалось удалить офлайн-копию."));
    } finally {
      setBusy(false);
    }
  }

  return { saved, message, busy, save, remove };
}

export function OfflineCopyControls({ copy, statusClassName }: { copy: OfflineCopy; statusClassName: string }) {
  const { locale, t } = useI18n();
  return <>
    <p className={statusClassName} role="status">{copy.message || (copy.saved === null ? t("Офлайн-копия ещё не сохранена") : offlineCopyLabel(copy.saved, locale))}</p>
    <button type="button" disabled={copy.busy} onClick={() => void copy.save()}>{t(copy.busy ? "Сохраняем…" : copy.saved === null ? "Сохранить прогулку без сети" : "Обновить офлайн-копию")}</button>
    {copy.saved !== null ? <button type="button" disabled={copy.busy} onClick={() => void copy.remove()}>{t("Удалить офлайн-копию")}</button> : null}
  </>;
}

function offlineCopyLabel(value: number, locale: Locale) {
  if (locale === "zh") return translate(locale, "Офлайн-копия сохранена · {count} записей", { count: value });
  if (locale === "en") return translate(locale, value === 1 ? "Офлайн-копия сохранена · {count} запись" : "Офлайн-копия сохранена · {count} записей", { count: value });
  const remainder = value % 10;
  const tens = value % 100;
  const key = tens >= 11 && tens <= 14 ? "Офлайн-копия сохранена · {count} записей" : remainder === 1 ? "Офлайн-копия сохранена · {count} запись" : remainder >= 2 && remainder <= 4 ? "Офлайн-копия сохранена · {count} записи" : "Офлайн-копия сохранена · {count} записей";
  return translate(locale, key, { count: value });
}
