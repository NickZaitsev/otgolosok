import { expect, it } from "vitest";
import { formatHolidayCaveat, formatHoursStatus, openingHoursStatus, parseOpeningHours } from "./opening-hours";
const at = (value: string, stamp: string) => openingHoursStatus(value, new Date(stamp));

it.each([
  ["24/7", "2026-10-05T23:00:00+03:00", "Открыто круглосуточно"],
  ["Mo-Su 09:00-22:00", "2026-10-05T09:00:00+03:00", "Открыто до 22:00"],
  ["Mo-Su 09:00-22:00", "2026-10-05T21:59:59+03:00", "Открыто до 22:00"],
  ["Mo-Su 09:00-22:00", "2026-10-05T22:00:00+03:00", "Закрыто, откроется завтра в 9:00"],
  ["Mo-Su 09:00-22:00", "2026-10-05T08:59:59+03:00", "Закрыто, откроется в 9:00"],
  ["Mo-Fr,Su 09:00-22:00", "2026-10-10T12:00:00+03:00", "Закрыто, откроется завтра в 9:00"],
  ["Sa,Su 09:00-22:00", "2026-10-05T12:00:00+03:00", "Закрыто, откроется в сб 9:00"],
  ["00:00-02:00,07:00-24:00", "2026-10-05T01:00:00+03:00", "Открыто до 02:00"],
  ["00:00-02:00,07:00-24:00", "2026-10-05T02:00:00+03:00", "Закрыто, откроется в 7:00"],
  ["00:00-02:00,07:00-24:00", "2026-10-05T23:59:00+03:00", "Открыто до 02:00"],
  ["Su 18:00-02:00", "2026-10-05T01:59:59+03:00", "Открыто до 02:00"],
  ["Su 18:00-02:00", "2026-10-05T02:00:00+03:00", "Закрыто, откроется в вс 18:00"],
  ["Mo 18:00-02:00", "2026-10-06T01:00:00+03:00", "Открыто до 02:00"],
  ["Mo-Su 00:00-24:00", "2026-10-05T12:00:00+03:00", "Открыто круглосуточно"],
  ["Mo-Su 10:00-24:00", "2026-10-05T12:00:00+03:00", "Открыто до полуночи"],
  ["Mo-Su 09:00-22:00; Mo 10:00-12:00", "2026-10-05T13:00:00+03:00", "Закрыто, откроется завтра в 9:00"],
  ["24/7; Sa-Su off", "2026-10-11T12:00:00+03:00", "Закрыто, откроется завтра в 0:00"],
  ["Mo-Su 18:00-02:00; Tu closed", "2026-10-06T01:00:00+03:00", "Закрыто, откроется завтра в 18:00"],
  ["Mo 09:00-10:00; Mo off", "2026-10-05T09:30:00+03:00", "Закрыто"],
  ["Mo off; Mo 09:00-10:00", "2026-10-05T09:30:00+03:00", "Открыто до 10:00"],
  ["Su-Th 12:00-24:00, Fr,Sa 12:00-02:00", "2026-10-10T01:00:00+03:00", "Открыто до 02:00"],
  ["Mo-Su 8:00-22:00", "2026-10-05T08:00:00+03:00", "Открыто до 22:00"],
  ["Mo-Su 00:00-00:00", "2026-10-05T12:00:00+03:00", "Открыто круглосуточно"],
  ["Mo-Fr 07:00-23:00; Sa, Su 08:00-22:00", "2026-10-10T08:00:00+03:00", "Открыто до 22:00"],
  ["closed", "2026-10-05T08:00:00+03:00", "Закрыто"],
  ["off", "2026-10-05T08:00:00+03:00", "Закрыто"],
])("%s at %s", (rule, date, label) => expect(formatHoursStatus(at(rule, date))).toBe(label));

it.each([null, "", "PH off", "week 01-10 Mo 09:00-22:00", "sunrise-sunset", "Jan-Mar 10:00-22:00", 'Mo 10:00-22:00 "comment"', "Mo 25:00-26:00", "Mo 24:00-02:00", "Mo 09:60-10:00", "Mo 10:00-10:00", "Mo-Su,PH 10:00-22:00", "24/7;", "nonsense", "Mo 10:00-24:01"])("unknown for %j", rule => {
  const result = openingHoursStatus(rule, new Date("2026-10-05T12:00:00Z"));
  expect(result.state).toBe("unknown");
  expect(formatHoursStatus(result)).toBe("Часы не указаны");
  expect(result.until).toBeUndefined();
});
it("ignores PH off with a separate caveat", () => {
  const result = at("Mo-Su 09:00-22:00; PH off", "2026-10-05T12:00:00+03:00");
  expect(result).toEqual({ state: "open", holidayCaveat: true, until: "22:00" });
  expect(formatHolidayCaveat(result)).toBe("В праздники часы работы могут отличаться");
  expect(formatHolidayCaveat(at("24/7", "2026-10-05T12:00:00Z"))).toBeNull();
});
it.each(["2026-10-05T08:00:00Z", "2026-10-05T01:00:00-07:00", "2026-10-05T17:00:00+09:00"])("uses Moscow for the same instant expressed as %s", stamp => {
  expect(at("10:00-12:00", stamp)).toEqual({ state: "open", holidayCaveat: false, until: "12:00" });
});
it("supports an explicit civil timezone and rejects an invalid date/timezone", () => {
  const now = new Date("2026-10-05T08:00:00Z");
  expect(openingHoursStatus("10:00-12:00", now, "America/Los_Angeles").state).toBe("closed");
  expect(openingHoursStatus("24/7", new Date(NaN)).state).toBe("unknown");
  expect(openingHoursStatus("24/7", now, "Invalid/Zone").state).toBe("unknown");
});
it("returns the next opening within a week with structured day and time", () => {
  expect(at("Mo 09:00-10:00", "2026-10-05T10:00:00+03:00").opensAt).toEqual({ day: "пн", time: "09:00", daysAhead: 7 });
  expect(parseOpeningHours("Mo-Fr,Su 09:00-22:00")?.minutes.length).toBe(10080);
});
