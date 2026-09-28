const sampleRate = 32000;
const seconds = 24;
const samples = sampleRate * seconds;

const chords = [
  [110, 130.81, 164.81, 196],
  [87.31, 110, 130.81, 164.81],
  [130.81, 164.81, 196, 246.94],
  [98, 123.47, 146.83, 164.81],
];

const bellTimes = [0, 3.5, 7, 13, 19.5];

function chordAt(index, time) {
  return chords[index].reduce((sum, frequency, voice) => {
    const phase = 2 * Math.PI * frequency * time;
    const swell = 0.83 + 0.17 * Math.sin(2 * Math.PI * (0.13 + voice * 0.03) * time);
    return sum + swell * (Math.sin(phase) * 0.75 + Math.sin(phase * 2) * 0.17 + Math.sin(phase * 3) * 0.08);
  }, 0) / chords[index].length;
}

/** Музыкальная подложка рекламного ролика: 24 с, моно, 16 бит; при каждом вызове одни и те же байты. */
export function adBedWav() {
  const wav = Buffer.allocUnsafe(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);

  let noiseState = 0x10293847;
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const section = Math.min(3, Math.floor(time / 6));
    const sectionTime = time - section * 6;
    const crossfade = Math.max(0, Math.min(1, (sectionTime - 5.1) / 0.9));
    const pad = chordAt(section, time) * (1 - crossfade) + chordAt((section + 1) % 4, time) * crossfade;

    const pulseTime = time % 0.75;
    const pulse = Math.sin(2 * Math.PI * (chords[section][0] / 2) * time) * Math.exp(-pulseTime * 11);
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    const noise = (noiseState / 0x7fffffff) * Math.exp(-pulseTime * 52);

    let bell = 0;
    for (const start of bellTimes) {
      const elapsed = time - start;
      if (elapsed >= 0 && elapsed < 1.2) {
        bell += Math.sin(2 * Math.PI * 659.26 * elapsed) * Math.exp(-elapsed * 5);
      }
    }

    const fadeIn = Math.min(1, time / 0.35);
    const fadeOut = Math.min(1, (seconds - time) / 1.3);
    const value = (pad * 0.19 + pulse * 0.13 + noise * 0.009 + bell * 0.055) * fadeIn * fadeOut;
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2);
  }
  return wav;
}
