"use client";

import { useEffect, useState } from "react";
import { toUserMessage } from "@/lib/errors/user-message";
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
      if (result.foodWarning) setMessage("Заведения не сохранены");
    } catch (caught) {
      setMessage(toUserMessage(caught, "Не удалось сохранить офлайн-копию."));
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
      setMessage("Не удалось удалить офлайн-копию.");
    } finally {
      setBusy(false);
    }
  }

  return { saved, message, busy, save, remove };
}

export function OfflineCopyControls({ copy, statusClassName }: { copy: OfflineCopy; statusClassName: string }) {
  return <>
    <p className={statusClassName} role="status">{copy.message || (copy.saved === null ? "Офлайн-копия ещё не сохранена" : `Офлайн-копия сохранена · ${copy.saved} ${audioWord(copy.saved)}`)}</p>
    <button type="button" disabled={copy.busy} onClick={() => void copy.save()}>{copy.busy ? "Сохраняем…" : copy.saved === null ? "Сохранить прогулку без сети" : "Обновить офлайн-копию"}</button>
    {copy.saved !== null ? <button type="button" disabled={copy.busy} onClick={() => void copy.remove()}>Удалить офлайн-копию</button> : null}
  </>;
}

function audioWord(value: number) {
  const remainder = value % 10;
  const tens = value % 100;
  return tens >= 11 && tens <= 14 ? "записей" : remainder === 1 ? "запись" : remainder >= 2 && remainder <= 4 ? "записи" : "записей";
}
