// Детерминированно синтезирует фон и щелчок для видеоинструкции.
// Файлы создаются при подготовке ресурсов и в Git не хранятся.

const SAMPLE_RATE = 32000;

function wavFromSamples(samples) {
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, samples.length);
  for (let index = 0; index < samples.length; index += 1) pcm[index] = Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767);
  return wav;
}

// Спокойная последовательность: Fmaj7 → Am7 → Dm9 → Cmaj7, по 8 секунд на аккорд.
const CHORDS = [
  [87.31, 130.81, 164.81, 220],
  [110, 130.81, 164.81, 196],
  [73.42, 110, 130.81, 174.61],
  [65.41, 98, 123.47, 164.81],
];
const CHORD_SECONDS = 8;

function chord(notes, time) {
  return notes.reduce((sum, frequency, voice) => {
    const phase = 2 * Math.PI * frequency * time;
    const breathe = 0.8 + 0.2 * Math.sin(2 * Math.PI * (0.07 + voice * 0.02) * time + voice);
    return sum + breathe * (Math.sin(phase) * 0.8 + Math.sin(phase * 2.001) * 0.14 + Math.sin(phase * 3) * 0.06);
  }, 0) / notes.length;
}

/** Мягкий фон под голос: без ударных, чтобы не спорить с дикторским текстом. */
export function guideBedWav(seconds) {
  if (!(Number.isFinite(seconds) && seconds > 0)) throw new RangeError("Длительность фона должна быть положительной");
  const total = Math.round(seconds * SAMPLE_RATE);
  const samples = new Float64Array(total);
  const crossfadeSeconds = 2;
  for (let index = 0; index < total; index += 1) {
    const time = index / SAMPLE_RATE;
    const section = Math.floor(time / CHORD_SECONDS);
    const local = time - section * CHORD_SECONDS;
    const blend = Math.max(0, Math.min(1, (local - (CHORD_SECONDS - crossfadeSeconds)) / crossfadeSeconds));
    const pad = chord(CHORDS[section % CHORDS.length], time) * (1 - blend) + chord(CHORDS[(section + 1) % CHORDS.length], time) * blend;
    // Редкий колокольчик в начале каждого аккорда — квинта основного тона.
    const bell = Math.sin(2 * Math.PI * CHORDS[section % CHORDS.length][0] * 6 * local) * Math.exp(-local * 3.2);
    const fade = Math.min(1, time / 2, (seconds - time) / 3);
    samples[index] = (pad * 0.34 + bell * 0.035) * fade;
  }
  return wavFromSamples(samples);
}

/** Короткий щелчок мыши: затухающий шум и тон 2,2 кГц, 60 мс. */
export function clickWav() {
  const total = Math.round(0.06 * SAMPLE_RATE);
  const samples = new Float64Array(total);
  let state = 0x2f6e2b1;
  let previous = 0;
  for (let index = 0; index < total; index += 1) {
    const time = index / SAMPLE_RATE;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const noise = (state / 0x7fffffff) * Math.exp(-time * 180);
    previous = previous * 0.55 + noise * 0.45;
    samples[index] = previous * 0.55 + Math.sin(2 * Math.PI * 2200 * time) * Math.exp(-time * 90) * 0.35;
  }
  return wavFromSamples(samples);
}
