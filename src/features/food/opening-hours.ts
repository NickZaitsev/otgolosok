const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const RU_DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const DAY_MINUTES = 1440, WEEK_MINUTES = 7 * DAY_MINUTES;
export type HoursStatus = {
  state: "open" | "closed" | "unknown"; holidayCaveat: boolean;
  until?: string; roundTheClock?: boolean; opensAt?: { day: string; time: string; daysAhead: number };
};
export type ParsedHours = { minutes: Uint8Array; holidayCaveat: boolean };
const clock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
function time(value: string, end: boolean): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour < 24 || end && hour === 24 && minute === 0 ? hour * 60 + minute : null;
}
function days(value: string): number[] | null {
  const selected = new Set<number>();
  for (const part of value.split(",")) {
    const match = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part);
    if (!match) return null;
    const first = DAYS.indexOf(match[1]), last = DAYS.indexOf(match[2] ?? match[1]);
    for (let d = first; ; d = (d + 1) % 7) { selected.add(d); if (d === last) break; }
  }
  return [...selected];
}

/** Conservative weekly subset. Unsupported fragments invalidate the whole expression. */
export function parseOpeningHours(value: string | null | undefined): ParsedHours | null {
  if (!value?.trim()) return null;
  const minutes = new Uint8Array(WEEK_MINUTES);
  const schedule = Array.from({ length: 7 }, () => ({ order: -1, intervals: [] as Array<[number, number]> }));
  let order = 0;
  let holidayCaveat = false, hasSchedule = false;
  // OSM also separates day-qualified rules with a comma instead of a semicolon.
  const rules = value.trim().replace(/(\d{1,2}:[0-5]\d|off|closed)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)[\w,\-]*\s+(?:\d|off\b|closed\b))/g, "$1;").replace(/,\s+(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, ",").split(";");
  for (const raw of rules) {
    const rule = raw.trim();
    if (rule === "PH off") { holidayCaveat = true; continue; }
    if (rule === "24/7") {
      for (const day of schedule) { day.order = order; day.intervals = [[0, DAY_MINUTES]]; }
      order += 1; hasSchedule = true; continue;
    }
    const match = /^(?:([A-Za-z,\-]+)\s+)?(.+)$/.exec(rule);
    if (!match) return null;
    const selected = match[1] ? days(match[1]) : [0, 1, 2, 3, 4, 5, 6];
    if (!selected) return null;
    const intervals: Array<[number, number]> = [];
    if (!["off", "closed"].includes(match[2])) {
      for (const span of match[2].split(",")) {
        const range = /^(\d{1,2}:[0-5]\d)-(\d{1,2}:[0-5]\d)$/.exec(span.trim());
        if (!range) return null;
        const start = time(range[1], false), end = time(range[2], true);
        if (start === null || end === null || start === end && start !== 0) return null;
        intervals.push([start, end <= start ? end + DAY_MINUTES : end]);
      }
    }
    for (const day of selected) schedule[day] = { order, intervals };
    order += 1;
    hasSchedule = true;
  }
  for (let day = 0; day < 7; day += 1) for (const [start, end] of schedule[day].intervals) {
    for (let m = start; m < end; m += 1) {
      // A later next-day override also overrides the inherited overnight tail.
      if (m >= DAY_MINUTES && schedule[(day + 1) % 7].order > schedule[day].order) continue;
      minutes[(day * DAY_MINUTES + m) % WEEK_MINUTES] = 1;
    }
  }
  return hasSchedule ? { minutes, holidayCaveat } : null;
}

/** Always uses the chosen civil timezone, independent of the device timezone. */
export function openingHoursStatus(value: string | null | undefined, now = new Date(), timeZone = "Europe/Moscow"): HoursStatus {
  return parsedOpeningHoursStatus(parseOpeningHours(value), value, now, timeZone);
}

/** Evaluate a cached weekly schedule without allocating another minute table. */
export function parsedOpeningHoursStatus(parsed: ParsedHours | null, value: string | null | undefined, now = new Date(), timeZone = "Europe/Moscow"): HoursStatus {
  const holidayCaveat = parsed?.holidayCaveat ?? /(?:^|;)\s*PH off\s*(?:;|$)/.test(value ?? "");
  const unknown: HoursStatus = { state: "unknown", holidayCaveat };
  if (!parsed || !Number.isFinite(now.getTime())) return unknown;
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now); }
  catch { return unknown; }
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  const minute = Number(get("hour")) * 60 + Number(get("minute")), index = day * DAY_MINUTES + minute;
  if (parsed.minutes[index]) {
    let step = 1;
    while (step < WEEK_MINUTES && parsed.minutes[(index + step) % WEEK_MINUTES]) step += 1;
    return step === WEEK_MINUTES ? { state: "open", holidayCaveat, roundTheClock: true }
      : { state: "open", holidayCaveat, until: clock((index + step) % DAY_MINUTES) };
  }
  for (let step = 1; step <= WEEK_MINUTES; step += 1) {
    if (!parsed.minutes[(index + step) % WEEK_MINUTES]) continue;
    const daysAhead = Math.floor((minute + step) / DAY_MINUTES);
    return { state: "closed", holidayCaveat, opensAt: { day: RU_DAYS[(day + daysAhead) % 7], time: clock((minute + step) % DAY_MINUTES), daysAhead } };
  }
  return { state: "closed", holidayCaveat };
}
export function formatHoursStatus(status: HoursStatus): string {
  if (status.state === "unknown") return "Часы не указаны";
  if (status.state === "open") return status.roundTheClock ? "Открыто круглосуточно" : status.until === "00:00" ? "Открыто до полуночи" : `Открыто до ${status.until}`;
  if (!status.opensAt) return "Закрыто";
  const { day, time, daysAhead } = status.opensAt;
  const at = time.replace(/^0(?=\d)/, "");
  return `Закрыто, откроется ${daysAhead === 0 ? `в ${at}` : daysAhead === 1 ? `завтра в ${at}` : `в ${day} ${at}`}`;
}
export const formatHolidayCaveat = (status: HoursStatus) => status.holidayCaveat ? "В праздники часы работы могут отличаться" : null;
