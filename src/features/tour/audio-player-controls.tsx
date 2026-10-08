import { formatPlaybackTime } from "@/lib/audio/playback-progress";
import { useI18n } from "@/lib/i18n/provider";
import { cx } from "../ui/cx";
import { playbackRates, type PlaybackRate } from "./walk-settings";
import styles from "./audio-player-controls.module.css";

type Props = {
  className?: string;
  position: number;
  duration: number;
  canSeek: boolean;
  playing: boolean;
  label: string;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
} & (
  // The compact player has no speed buttons: the walk sets the speed in its settings.
  | { compact: true; walk?: boolean; rate?: PlaybackRate; onRate?: (rate: PlaybackRate) => void }
  | { compact?: false; rate: PlaybackRate; onRate: (rate: PlaybackRate) => void }
);

const rateLabel = (rate: PlaybackRate, languageTag: string) => `${rate.toLocaleString(languageTag)}×`;

export function AudioPlayerControls(props: Props) {
  const { languageTag, t } = useI18n();
  const { className, position, duration, canSeek, playing, label, onToggle, onSeek } = props;
  const maximum = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const current = Math.min(maximum, Math.max(0, position));
  if (props.compact && props.walk) return <section className={cx(styles.walk, className)} aria-label={t("Плеер истории")}>
    <div className={styles.walkTimeline}>
      <input type="range" min={0} max={maximum || 1} step="any" value={current} disabled={!canSeek}
        aria-label={t("Позиция воспроизведения")} aria-valuetext={t("{current} из {duration}", { current: formatPlaybackTime(current), duration: formatPlaybackTime(maximum) })}
        onChange={event => onSeek(Number(event.target.value))} />
      <div className={styles.time} aria-hidden="true"><span>{formatPlaybackTime(current)}</span><span>{formatPlaybackTime(maximum)}</span></div>
    </div>
    <div className={styles.walkButtons}>
      <button type="button" className={styles.walkSkip} aria-label={t("Назад на 15 секунд")}
        disabled={!canSeek || current <= 0} onClick={() => onSeek(Math.max(0, current - 15))}><span aria-hidden="true">↶</span><small>{t("15 с")}</small></button>
      <button type="button" className={styles.walkToggle} onClick={onToggle} aria-label={label}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="m8 4 12 8-12 8z" />}</svg>
        <span>{label}</span>
      </button>
      <button type="button" className={styles.walkSkip} aria-label={t("Вперёд на 15 секунд")}
        disabled={!canSeek || current >= maximum} onClick={() => onSeek(Math.min(maximum, current + 15))}><span aria-hidden="true">↷</span><small>{t("15 с")}</small></button>
    </div>
  </section>;
  if (props.compact) return <section className={cx(styles.compact, className)} aria-label={t("Плеер истории")}>
    <button type="button" aria-label={label} onClick={onToggle}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="m8 4 12 8-12 8z" />}</svg>
    </button>
    <div><input type="range" min={0} max={maximum || 1} step="any" value={current} disabled={!canSeek}
      aria-label={t("Позиция воспроизведения")} aria-valuetext={t("{current} из {duration}", { current: formatPlaybackTime(current), duration: formatPlaybackTime(maximum) })}
      onChange={event => onSeek(Number(event.target.value))} />
      <div className={styles.time} aria-hidden="true"><span>{formatPlaybackTime(current)}</span><span>{formatPlaybackTime(maximum)}</span></div>
    </div>
  </section>;
  const { rate, onRate } = props;
  return <section className={cx("audio-player", className)} aria-label={t("Плеер истории")}>
    <div className="audio-player-time" aria-hidden="true">
      <span>{formatPlaybackTime(current)}</span><span>{formatPlaybackTime(maximum)}</span>
    </div>
    <input type="range" className="audio-timeline" min={0} max={maximum || 1} step="any"
      value={current} disabled={!canSeek} aria-label={t("Позиция воспроизведения")}
      aria-valuetext={t("{current} из {duration}", { current: formatPlaybackTime(current), duration: formatPlaybackTime(maximum) })}
      onChange={(event) => onSeek(Number(event.target.value))} />
    <div className="audio-player-buttons">
      <button type="button" className="audio-skip" aria-label={t("Назад на 15 секунд")}
        disabled={!canSeek || current <= 0} onClick={() => onSeek(current - 15)}><span aria-hidden="true">↶</span>{t("15 с")}</button>
      <button className="audio-button" type="button" onClick={onToggle}>
        <span>{label}</span><b aria-hidden="true">{playing ? "Ⅱ" : "▶"}</b>
      </button>
      <button type="button" className="audio-skip" aria-label={t("Вперёд на 15 секунд")}
        disabled={!canSeek || current >= maximum} onClick={() => onSeek(current + 15)}><span aria-hidden="true">↷</span>{t("15 с")}</button>
    </div>
    <div className="audio-rate" role="group" aria-label={t("Скорость рассказа")}>
      {playbackRates.map((value) => (
        <button key={value} type="button" aria-pressed={value === rate}
          aria-label={t("Скорость {rate}", { rate: rateLabel(value, languageTag) })} onClick={() => onRate(value)}>{rateLabel(value, languageTag)}</button>
      ))}
    </div>
  </section>;
}
