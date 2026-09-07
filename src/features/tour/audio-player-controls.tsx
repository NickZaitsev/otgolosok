import { formatPlaybackTime } from "@/lib/audio/playback-progress";

type Props = {
  position: number;
  duration: number;
  canSeek: boolean;
  playing: boolean;
  label: string;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
};

export function AudioPlayerControls({ position, duration, canSeek, playing, label, onToggle, onSeek }: Props) {
  const maximum = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const current = Math.min(maximum, Math.max(0, position));
  return <section className="audio-player" aria-label="Плеер истории">
    <div className="audio-player-time" aria-hidden="true">
      <span>{formatPlaybackTime(current)}</span><span>{formatPlaybackTime(maximum)}</span>
    </div>
    <input type="range" className="audio-timeline" min={0} max={maximum || 1} step="any"
      value={current} disabled={!canSeek} aria-label="Позиция воспроизведения"
      aria-valuetext={`${formatPlaybackTime(current)} из ${formatPlaybackTime(maximum)}`}
      onChange={(event) => onSeek(Number(event.target.value))} />
    <div className="audio-player-buttons">
      <button type="button" className="audio-skip" aria-label="Назад на 15 секунд"
        disabled={!canSeek || current <= 0} onClick={() => onSeek(current - 15)}><span aria-hidden="true">↶</span>15 с</button>
      <button className="audio-button" type="button" onClick={onToggle}>
        <span>{label}</span><b aria-hidden="true">{playing ? "Ⅱ" : "▶"}</b>
      </button>
      <button type="button" className="audio-skip" aria-label="Вперёд на 15 секунд"
        disabled={!canSeek || current >= maximum} onClick={() => onSeek(current + 15)}><span aria-hidden="true">↷</span>15 с</button>
    </div>
  </section>;
}
