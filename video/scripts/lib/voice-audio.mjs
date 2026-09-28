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

/**
 * Выравнивает громкость речи клипа: RMS отрезка речи → `target`, но пик не выше `peak`.
 * Короткие реплики F5 выходят на 18–22 дБ тише длинных — без этого они тонут в музыке.
 * @param {Buffer} pcm моно s16le
 * @param {{start: number, end: number}} bounds границы речи в секундах (speechBounds)
 * @returns {Buffer} новый буфер
 */
export function normalizeSpeech(pcm, sampleRate, bounds, {target = 10 ** (-17 / 20), peak = 10 ** (-1 / 20)} = {}) {
  const from = Math.round(bounds.start * sampleRate);
  const to = Math.min(pcm.length / 2, Math.round(bounds.end * sampleRate));
  const level = rms(pcm, from, to);
  if (!(level > 0)) throw new Error("В клипе озвучки нет речи");
  let loudest = 0;
  for (let index = 0; index < pcm.length / 2; index += 1) loudest = Math.max(loudest, Math.abs(pcm.readInt16LE(index * 2)) / 32768);
  const gain = Math.min(target / level, peak / loudest);
  const out = Buffer.alloc(pcm.length);
  for (let index = 0; index < pcm.length / 2; index += 1) {
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(index * 2) * gain))), index * 2);
  }
  return out;
}

/**
 * Затухание дорожки к моменту `to` (секунды) и тишина после него: так историю можно
 * оборвать на склейке, не дочитав.
 * @param {Buffer} track моно s16le, меняется на месте
 */
export function fadeOut(track, {from, to, sampleRate}) {
  if (!(to > from) || from < 0) throw new RangeError("Отрезок затухания должен иметь длину");
  const start = Math.round(from * sampleRate);
  const end = Math.round(to * sampleRate);
  for (let index = start; index < track.length / 2; index += 1) {
    const gain = index >= end ? 0 : Math.cos(((index - start) / (end - start)) * (Math.PI / 2));
    track.writeInt16LE(Math.round(track.readInt16LE(index * 2) * gain), index * 2);
  }
  return track;
}
