// Музыка моушн-ролика: 120 уд/мин (удар = 15 кадров при 30 кадр/с), эхо-сигнал
// в начале, шелест и удар на каждой склейке, приглушение под голосом истории.
const SAMPLE_RATE = 32000;
const BEAT = 0.5;

const chords = [
  [110, 130.81, 164.81, 220],
  [87.31, 130.81, 174.61, 220],
  [130.81, 164.81, 196, 261.63],
  [98, 146.83, 196, 246.94],
];

function wavHeader(samples) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples * 2, 40);
  return header;
}

function ping(elapsed, frequency) {
  if (elapsed < 0 || elapsed > 1.6) return 0;
  return (Math.sin(2 * Math.PI * frequency * elapsed) + 0.3 * Math.sin(2 * Math.PI * frequency * 2.01 * elapsed)) * Math.exp(-elapsed * 4);
}

/**
 * @param {{seconds: number, cuts: number[], duck: [number, number], groove: number, finale: number}} score
 *   Время в секундах: склейки, отрезок под голосом, начало ритма и финальный аккорд.
 */
export function motionBedWav({seconds, cuts, duck, groove, finale}) {
  if (!(seconds > 0) || cuts.some((cut) => cut <= 0 || cut >= seconds)) {
    throw new RangeError("Склейки музыки должны лежать внутри ролика");
  }
  const samples = Math.round(seconds * SAMPLE_RATE);
  const data = Buffer.alloc(samples * 2);
  let noise = 0x2f6b1a93;
  let lowpass = 0;

  for (let index = 0; index < samples; index += 1) {
    const time = index / SAMPLE_RATE;
    noise ^= noise << 13;
    noise ^= noise >>> 17;
    noise ^= noise << 5;
    const white = noise / 0x7fffffff;
    lowpass += (white - lowpass) * 0.08;

    const chord = chords[Math.floor(time / (BEAT * 8)) % chords.length];
    const pad = chord.reduce((sum, frequency, voice) => {
      const phase = 2 * Math.PI * frequency * time;
      const swell = 0.8 + 0.2 * Math.sin(2 * Math.PI * (0.11 + voice * 0.04) * time);
      return sum + swell * (Math.sin(phase) * 0.7 + Math.sin(phase * 2.003) * 0.2);
    }, 0) / chord.length;

    // Отголосок: сигнал и затухающие повторы, как эхо во дворе.
    let echo = 0;
    for (let repeat = 0; repeat < 6; repeat += 1) {
      echo += ping(time - 0.15 - repeat * 0.375, 880) * 0.62 ** repeat;
      echo += ping(time - finale - repeat * 0.375, 659.26) * 0.6 ** repeat;
    }
    echo += ping(time - finale, 440) * 0.8;

    let rhythm = 0;
    if (time >= groove && time < finale) {
      const beatTime = (time - groove) % BEAT;
      const kickPhase = 2 * Math.PI * (48 * beatTime + 90 * (1 - Math.exp(-beatTime * 30)) / 30);
      rhythm += Math.sin(kickPhase) * Math.exp(-beatTime * 9) * 0.9;
      const offbeat = ((time - groove + BEAT / 2) % BEAT);
      rhythm += white * Math.exp(-offbeat * 60) * 0.12;
      rhythm += Math.sin(2 * Math.PI * chord[0] / 2 * time) * Math.exp(-beatTime * 5) * 0.35;
    }

    let transitions = 0;
    for (const cut of cuts) {
      const before = cut - time;
      if (before > 0 && before < 0.55) transitions += lowpass * (1 - before / 0.55) ** 2 * 3.2;
      const after = time - cut;
      if (after >= 0 && after < 0.8) transitions += Math.sin(2 * Math.PI * 55 * after) * Math.exp(-after * 7) * 0.9;
    }

    const underVoice = time > duck[0] && time < duck[1] ? 0.4 : 1;
    const fadeIn = Math.min(1, time / 0.08);
    const fadeOut = Math.min(1, (seconds - time) / 1.2);
    const value = ((pad * 0.16 + rhythm * 0.22) * underVoice + echo * 0.09 + transitions * 0.14) * fadeIn * fadeOut;
    data.writeInt16LE(Math.round(Math.tanh(value * 2.4) * 0.92 * 32767), index * 2);
  }
  return Buffer.concat([wavHeader(samples), data]);
}
