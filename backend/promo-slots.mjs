// Publication slots of the promo queue: Mon–Thu 20:30 and Fri–Sun 21:30 Moscow time (owner, 2026-10-14).
// Moscow has no DST (UTC+3), so a slot is a fixed UTC time on the Moscow calendar day.
// Mirrored in otgolosok-shorts (src/promo/slots.ts) with the same table-driven tests.
// Creative weekdays belong to otgolosok-creative (owner, 2026-10-19): the queue takes no slot on them;
// shorts publishes the creative package of that day itself. Both read PROMO_CREATIVE_WEEKDAYS.

const MSK_OFFSET_MS = 3 * 60 * 60_000;
/** Minimal distance between "now" and the first slot, so a slot is never assigned in the last minutes. */
export const SLOT_LEAD_MS = 30 * 60_000;

/** Moscow time of the slot on a Moscow weekday (0 = Sunday), in minutes after midnight. */
export const slotMinutesMsk = weekday => (weekday >= 1 && weekday <= 4 ? 20 * 60 + 30 : 21 * 60 + 30);

/**
 * Weekdays (0 = Sunday) of otgolosok-creative from `PROMO_CREATIVE_WEEKDAYS`: "1" = Monday (default), "" = none.
 * @param {string} [value] @returns {ReadonlySet<number>}
 */
export function creativeWeekdays(value = process.env.PROMO_CREATIVE_WEEKDAYS ?? "1") {
  const days = value.split(",").map(part => part.trim()).filter(Boolean).map(Number);
  if (days.some(day => !Number.isInteger(day) || day < 0 || day > 6))
    throw new Error(`PROMO_CREATIVE_WEEKDAYS: дни недели 0–6 через запятую, получено «${value}»`);
  return new Set(days);
}

/** Moscow calendar day (`YYYY-MM-DD`) of an instant. @param {string | Date} at */
export const moscowDate = at => new Date(new Date(at).getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);

/**
 * The next `count` queue slots strictly after `now + SLOT_LEAD_MS`, as ISO strings in UTC; creative weekdays are skipped.
 * @param {Date} now @param {number} count @param {ReadonlySet<number>} [creative] @returns {string[]}
 */
export function nextSlots(now, count, creative = creativeWeekdays()) {
  const earliest = now.getTime() + SLOT_LEAD_MS;
  const moscow = new Date(now.getTime() + MSK_OFFSET_MS);
  const slots = [];
  for (let day = 0; slots.length < count; day++) {
    if (creative.size === 7) break;
    const date = new Date(Date.UTC(moscow.getUTCFullYear(), moscow.getUTCMonth(), moscow.getUTCDate() + day));
    if (creative.has(date.getUTCDay())) continue;
    const at = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, slotMinutesMsk(date.getUTCDay())) - MSK_OFFSET_MS;
    if (at > earliest) slots.push(new Date(at).toISOString());
  }
  return slots;
}
