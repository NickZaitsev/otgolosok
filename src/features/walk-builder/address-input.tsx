"use client";

import { useRef, useState } from "react";
import { ExploreIcon } from "../explore/icons";
import styles from "./walk-creation-panel.module.css";
import { useI18n } from "@/lib/i18n/provider";

export function AddressInput({ label, initialValue = "", onResolve, onCancel, disabled = false }: {
  label: string; initialValue?: string; onResolve: (query: string) => Promise<void>; onCancel: () => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialValue);
  const pending = useRef(false);
  return <form className={styles.addressEditor} onSubmit={async event => {
    event.preventDefault();
    if (disabled || pending.current || query.trim().length < 3) return;
    pending.current = true;
    try { await onResolve(query.trim()); }
    finally { pending.current = false; }
  }}>
    <label className={styles.addressLabel}><span>{label}</span><input disabled={disabled} autoFocus value={query} required minLength={3} maxLength={180} placeholder={t("Улица и номер дома")} autoComplete="street-address" enterKeyHint="done" onChange={event => setQuery(event.target.value)} /></label>
    <button type="submit" className={styles.addressSubmit} disabled={disabled || query.trim().length < 3} aria-label={t("Подтвердить адрес")}>{disabled ? "…" : "✓"}</button>
    <button type="button" className={styles.addressCancel} disabled={disabled} onClick={onCancel} aria-label={t("Отменить ввод: {label}", { label })}><ExploreIcon name="close" /></button>
  </form>;
}
