import {describe, expect, it} from "vitest";
import {clickWav, guideBedWav} from "../../scripts/build-guide-audio.mjs";

function samples(wav: Buffer) {
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.toString("ascii", 8, 16)).toBe("WAVEfmt ");
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
  return Array.from({length: (wav.length - 44) / 2}, (_, i) => wav.readInt16LE(44 + i * 2) / 32767);
}

describe("звук видеоинструкции", () => {
  it("фон имеет заданную длину, не клиппует и затухает к концу", () => {
    const wav = guideBedWav(12);
    expect(wav.readUInt32LE(24)).toBe(32000);
    const data = samples(wav);
    expect(data).toHaveLength(12 * 32000);
    const peak = data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(0.99);
    expect(Math.abs(data[0])).toBeLessThan(0.001);
    expect(Math.abs(data.at(-1)!)).toBeLessThan(0.001);
  });

  it("фон детерминирован", () => {
    expect(guideBedWav(3).equals(guideBedWav(3))).toBe(true);
  });

  it.each([0, -1, NaN, Infinity])("отклоняет длительность %s", seconds => {
    expect(() => guideBedWav(seconds)).toThrow(RangeError);
  });

  it("щелчок короткий и слышимый", () => {
    const data = samples(clickWav());
    expect(data.length / 32000).toBeCloseTo(0.06);
    expect(data.reduce((max, value) => Math.max(max, Math.abs(value)), 0)).toBeGreaterThan(0.2);
  });
});
