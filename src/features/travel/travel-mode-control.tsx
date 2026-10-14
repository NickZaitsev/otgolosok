"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useTravelSettings, type TravelMode } from "./settings";
import styles from "./travel-mode-control.module.css";

export function TravelModeControl({ value, onChange, disabled = false }: { value: TravelMode; onChange: (mode: TravelMode) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return <fieldset className={styles.control} disabled={disabled}><legend>{t("Как передвигаемся")}</legend><div>{(["walking", "driving"] as const).map(mode => <button key={mode} type="button" aria-pressed={value === mode} onClick={() => onChange(mode)}>{t(mode === "walking" ? "Пешком" : "На машине")}</button>)}</div></fieldset>;
}
export function TravelPreference() {
  const { t } = useI18n();
  const { travelMode, setTravelMode } = useTravelSettings();
  return <div><TravelModeControl value={travelMode} onChange={setTravelMode} /><p className={styles.hint}>{t("Выбор применяется к новым прогулкам на этом устройстве.")}</p></div>;
}
