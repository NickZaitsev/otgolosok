// Разбор озвучки для покадровых роликов: громкость по кадрам и границы речи в клипе.
// PCM везде моно s16le — так его отдаёт `ffmpeg -ac 1 -f s16le`.

/** Среднеквадратичная громкость отрезка сэмплов [from, to), 0…1. */
function rms(pcm, from, to) {
  let sum = 0;
  let count = 0;
  for (let index = from; index < to && index * 2 + 1 < pcm.length; index += 1) {
    const sample = pcm.readInt16LE(index * 2) / 32768;
    sum += sample * sample;
    count += 1;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/**
 * Громкость озвучки по кадрам, 0…1, для эквалайзера на экране.
 * @param {Buffer} pcm моно s16le
 * @param {number} sampleRate
 * @param {{fps?: number, seconds: number}} options
 */
export function voiceLevels(pcm, sampleRate, {fps = 30, seconds}) {
  const perFrame = Math.round(sampleRate / fps);
  const frames = Math.round(seconds * fps);
  const values = Array.from({length: frames}, (_, frame) => rms(pcm, frame * perFrame, (frame + 1) * perFrame));
  const peak = values.reduce((max, value) => Math.max(max, value), 0);
  if (!(peak > 0)) throw new Error("Фрагмент озвучки беззвучен");
  return values.map((value) => Number(Math.sqrt(value / peak).toFixed(3)));
}

/**
 * Где в клипе звучит голос: первое и последнее окно 20 мс громче порога (−40 дБ).
 * Короткий шум дальше `maxPause` от речи (вдох, щелчок в хвосте TTS) речью не считается.
 * @param {Buffer} pcm моно s16le
 * @param {number} sampleRate
 * @returns {{start: number, end: number}} секунды от начала клипа
 */
export function speechBounds(pcm, sampleRate, {threshold = 0.01, window = 0.02, maxPause = 0.5} = {}) {
  const size = Math.round(sampleRate * window);
  const windows = Math.floor(pcm.length / 2 / size);
  const loud = Array.from({length: windows}, (_, index) => rms(pcm, index * size, (index + 1) * size) >= threshold);
  const first = loud.indexOf(true);
  if (first < 0) throw new Error("В клипе озвучки нет речи");
  let last = first;
  for (let index = first; index < windows; index += 1) {
    if (!loud[index]) continue;
    if ((index - last) * window > maxPause) break;
    last = index;
  }
  return {start: Number((first * window).toFixed(3)), end: Number(((last + 1) * window).toFixed(3))};
}
