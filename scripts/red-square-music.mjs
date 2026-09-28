// Музыка ролика «Красная площадь и Варварка»: 120 уд/мин, ля минор (Am–F–C–G по такту).
// Колокола на куполах в начале и в финале, бочка с ask до финала (под экраном
// истории — вполсилы), арпеджио под фактами и картой, подъём шума перед склейкой и удар
// на ней, стук табло. Всё синтезируется детерминированно, без сэмплов.
export const SAMPLE_RATE = 48000;

const TAU = 2 * Math.PI;
const note = (semitones) => 220 * 2 ** (semitones / 12);
/** Аккорды по тактам (2 с): Am, F, C, G — полутона от A3. */
const CHORDS = [[-12, 0, 3, 7], [-16, -4, 0, 3], [-9, -5, -2, 3], [-14, -2, 2, 5]].map((chord) => chord.map(note));
/** Неравномерные обертоны колокола. */
const BELL = [[0.5, 0.9], [1, 1], [1.19, 0.55], [1.5, 0.45], [2, 0.5], [2.74, 0.3], [3.76, 0.18], [5.4, 0.1]];

/**
 * @typedef {{seconds: number, beat: number, groove: number, drive: [number, number], cuts: number[], hits: number[], bells: number[], ticks: number[], duck: [number, number], finale: number}} Score
 * groove — начало ритма, drive — отрезок с арпеджио и хлопками, duck — приглушение под экраном истории.
 */

function checkScore({seconds, beat, groove, drive, cuts, hits, bells, ticks, duck, finale}) {
  if (!(seconds > 0) || !(beat > 0)) throw new RangeError("Длина ролика и доля такта должны быть положительными");
  const events = [groove, ...drive, ...cuts, ...hits, ...bells, ...ticks, ...duck, finale];
  if (events.some((time) => !(time >= 0 && time <= seconds))) throw new RangeError("События музыки должны лежать внутри ролика");
  if (!(duck[1] > duck[0]) || !(drive[1] > drive[0])) throw new RangeError("Отрезки приглушения и арпеджио должны иметь длину");
}

/** Детерминированный белый шум (xorshift32), −1…1. */
function noiseSource(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 4294967296) * 2 - 1;
  };
}

const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function bell(elapsed, base, length = 3) {
  if (elapsed < 0 || elapsed > length) return 0;
  let value = 0;
  for (const [ratio, gain] of BELL) value += Math.sin(TAU * base * ratio * elapsed) * gain * Math.exp(-elapsed * (1.2 + ratio * 0.9));
  return value * Math.min(1, elapsed / 0.004);
}

function kick(elapsed) {
  if (elapsed < 0 || elapsed > 0.45) return 0;
  const phase = TAU * (45 * elapsed + (75 / 18) * (1 - Math.exp(-18 * elapsed)));
  return Math.sin(phase) * Math.exp(-elapsed * 7);
}

/**
 * Стерео-сэмплы −1…1.
 * @param {Score} score
 * @returns {{left: Float32Array, right: Float32Array}}
 */
export function redSquareSamples(score) {
  checkScore(score);
  const {seconds, beat, groove: grooveFrom, drive, cuts, hits, bells, ticks, duck, finale} = score;
  const length = Math.round(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const white = noiseSource(0x5eed1234);
  const bar = beat * 4;
  const [driveFrom, driveTo] = drive;
  let hiss = 0;
  let riserState = 0;

  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    const noise = white();
    const chord = CHORDS[Math.floor(time / bar) % CHORDS.length];
    const underVoice = time > duck[0] && time < duck[1];
    const inFinale = time >= finale;

    // Подложка: аккорд из слегка расстроенных пил (шесть гармоник), левый и правый канал расстроены по-разному.
    const padLevel = smooth(0, 2.5, time) * (underVoice ? 0.55 : 1) * (inFinale ? Math.exp(-(time - finale) * 0.35) : 1);
    let padLeft = 0;
    let padRight = 0;
    for (const frequency of chord) {
      for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
        const gain = 1 / harmonic ** 1.6;
        padLeft += Math.sin(TAU * frequency * 0.997 * harmonic * time) * gain;
        padRight += Math.sin(TAU * frequency * 1.003 * harmonic * time + 0.7) * gain;
      }
    }
    const swell = 0.75 + 0.25 * Math.sin(TAU * time / bar);

    // Ритм: бочка на долях от первой склейки до финала; под экраном истории — через долю.
    let drums = 0;
    if (time >= grooveFrom && !inFinale) {
      const sinceBeat = (time - grooveFrom) % beat;
      const beatIndex = Math.floor((time - grooveFrom) / beat);
      if (!underVoice || beatIndex % 2 === 0) drums += kick(sinceBeat) * 0.9;
      // Хэт на слабых восьмых с фактов до конца табло.
      const offbeat = (time - grooveFrom + beat / 2) % beat;
      if (time >= driveFrom && !underVoice && offbeat < 0.04) drums += noise * Math.exp(-offbeat * 120) * 0.25;
      // Хлопок на 2 и 4 в отрезке drive.
      if (time >= grooveFrom + 2 && time < driveTo && beatIndex % 2 === 1 && sinceBeat < 0.15) {
        drums += (noise * 0.6 + Math.sin(TAU * 190 * sinceBeat) * 0.3) * Math.exp(-sinceBeat * 28) * 0.45;
      }
    }

    // Арпеджио шестнадцатыми в отрезке drive, тише — под экраном истории.
    let arp = 0;
    if ((time >= driveFrom && time < driveTo) || underVoice) {
      const step = beat / 4;
      const stepIndex = Math.floor(time / step);
      const since = time - stepIndex * step;
      const pattern = [0, 1, 2, 3, 2, 1, 3, 2];
      const frequency = chord[pattern[stepIndex % pattern.length]] * 2;
      arp = (Math.sin(TAU * frequency * since) + 0.3 * Math.sin(TAU * frequency * 2 * since)) * Math.exp(-since * 14) * (underVoice ? 0.35 : 0.8);
    }

    // Подъём перед склейкой: шум открывается к удару; на склейке — суббас и всплеск шума.
    let riser = 0;
    let impact = 0;
    for (const cut of [...cuts, ...hits]) {
      const before = cut - time;
      if (before > 0 && before < 0.9) riser = Math.max(riser, (1 - before / 0.9) ** 2.2);
      const after = time - cut;
      if (after >= 0 && after < 0.9) {
        const strong = cuts.includes(cut) ? 1 : 0.55;
        impact += (Math.sin(TAU * 48 * after) * Math.exp(-after * 5) * 0.9 + noise * Math.exp(-after * 22) * 0.5) * strong;
      }
    }
    riserState += (noise - riserState) * (0.02 + riser * 0.5);
    hiss = riserState * riser;

    // Стук табло: серия щелчков, реже к концу строки.
    let clack = 0;
    for (const tick of ticks) {
      const after = time - tick;
      if (after < 0 || after > 0.5) continue;
      const interval = 0.028 + after * 0.08;
      const since = after % interval;
      if (since < 0.006) clack += noise * Math.exp(-since * 900) * (1 - after / 0.5);
    }

    // Колокола на куполах и финальный аккорд колоколов.
    let bells_ = 0;
    bells.forEach((at, order) => { bells_ += bell(time - at, [392, 330, 294, 262][order % 4], 2.6) * 0.5; });
    bells_ += bell(time - finale, 110, 4) * 0.9 + bell(time - finale - 0.02, 165, 4) * 0.5 + bell(time - finale - 0.04, 220, 4) * 0.4;

    const center = drums * 0.85 + impact * 0.5 + bells_ * 0.3 + arp * 0.14 + hiss * 0.4;
    const pad = 0.05 * padLevel * swell;
    left[index] = center + padLeft * pad + clack * 0.35 + bells_ * 0.05;
    right[index] = center + padRight * pad + clack * 0.25 - bells_ * 0.05;
  }

  // Мягкое ограничение, затем нормировка к −1 дБFS и плавные края.
  let peak = 0;
  for (let index = 0; index < length; index += 1) {
    left[index] = Math.tanh(left[index] * 1.6);
    right[index] = Math.tanh(right[index] * 1.6);
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
  }
  const gain = peak > 0 ? 0.89 / peak : 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    const edge = Math.min(1, time / 0.02, (seconds - time) / 0.8);
    left[index] *= gain * edge;
    right[index] *= gain * edge;
  }
  return {left, right};
}

/**
 * WAV 16 бит, стерео.
 * @param {Score} score
 */
export function redSquareWav(score) {
  const {left, right} = redSquareSamples(score);
  const data = Buffer.alloc(left.length * 4);
  for (let index = 0; index < left.length; index += 1) {
    data.writeInt16LE(Math.round(left[index] * 32767), index * 4);
    data.writeInt16LE(Math.round(right[index] * 32767), index * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
