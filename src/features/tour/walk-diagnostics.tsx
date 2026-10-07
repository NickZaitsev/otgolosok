import type { TriggerConfig, TriggerState } from "@/lib/geo/types";
import { useI18n } from "@/lib/i18n/provider";
import type { PositionSourceKind, PositionSourceStatus } from "@/lib/position";
import type { WakeLockStatus } from "@/lib/wake-lock";
import type { AudioStatus } from "./use-walk-audio";
import type { Diagnostics } from "./use-walk-position";
import { advanceModeLabels, type AdvanceMode } from "./walk-settings";

const sourceLabels: Record<PositionSourceStatus | "idle", string> = {
  idle: "ожидает",
  starting: "запрашиваем",
  active: "работает",
  stopped: "остановлен",
  complete: "трек завершён",
  "permission-denied": "доступ не дан",
  unavailable: "недоступна",
  error: "ошибка",
};

const sourceKindLabels: Record<PositionSourceKind, string> = { browser: "геолокация браузера", replay: "тестовый трек" };
const triggerPhaseLabels: Record<TriggerState["phase"], string> = { outside: "вне зоны", inside: "в зоне точки", cooldown: "точка пройдена" };

const wakeLabels: Record<WakeLockStatus, string> = {
  unsupported: "не поддерживается",
  idle: "ожидает",
  waiting: "ждёт активную вкладку",
  requesting: "запрашиваем",
  active: "экран активен",
  error: "не удалось включить",
  disposed: "выключен",
};

const audioLabels: Record<AudioStatus, string> = {
  locked: "не активирован",
  unlocking: "подготовка",
  ready: "готов",
  loading: "запускается",
  playing: "воспроизведение",
  paused: "пауза",
  ended: "запись закончилась",
  blocked: "нужно нажатие",
  error: "ошибка воспроизведения",
};

/** Field-testing panel, shown only with ?replay=… or ?debug=1. */
export function WalkDiagnostics({ diagnostics, replay, distanceLabel, triggerConfig, advance, audioStatus, wakeStatus }: {
  diagnostics: Diagnostics;
  replay: boolean;
  distanceLabel: string;
  triggerConfig: TriggerConfig;
  advance: AdvanceMode;
  audioStatus: AudioStatus;
  wakeStatus: WakeLockStatus;
}) {
  const { t } = useI18n();
  const candidateCount = diagnostics.trigger.recentInside.filter(Boolean).length;
  return <details className="debug-panel" open={replay || undefined}>
    <summary>{t("Диагностика")}{replay ? " · replay" : ""}</summary>
    <dl>
      <DebugValue label={t("Источник")} value={diagnostics.source ? t(sourceKindLabels[diagnostics.source]) : "—"} />
      <DebugValue label={t("Геопозиция")} value={t(sourceLabels[diagnostics.sourceStatus])} />
      <DebugValue label={t("Точность")} value={diagnostics.lastFix ? t("{distance} м", { distance: Math.round(diagnostics.lastFix.accuracyM) }) : "—"} />
      <DebugValue label={t(distanceLabel)} value={diagnostics.distanceM === null ? "—" : t("{distance} м", { distance: Math.round(diagnostics.distanceM) })} />
      <DebugValue label={t("Зона входа")} value={t("{distance} м", { distance: triggerConfig.enterM })} />
      <DebugValue label={t("Кандидаты")} value={`${candidateCount} / ${diagnostics.trigger.recentInside.length || triggerConfig.windowSize}`} />
      <DebugValue label={t("Триггер")} value={t(triggerPhaseLabels[diagnostics.trigger.phase])} />
      <DebugValue label={t("Переход")} value={t(advanceModeLabels[advance])} />
      <DebugValue label={t("Аудио")} value={t(audioLabels[audioStatus])} />
      <DebugValue label={t("Экран")} value={t(wakeLabels[wakeStatus])} />
    </dl>
    {diagnostics.sourceError ? <p className="debug-error">{diagnostics.sourceError}</p> : null}
  </details>;
}

function DebugValue({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
