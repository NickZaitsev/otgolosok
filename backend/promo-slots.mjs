// Publication slots of the promo queue: Mon–Thu 19:30 and Fri–Sun 21:00 Moscow time (owner, 2026-10-07).
// Moscow has no DST (UTC+3), so a slot is a fixed UTC time on the Moscow calendar day.
// Mirrored in otgolosok-shorts (src/promo/slots.ts) with the same table-driven tests.

const MSK_OFFSET_MS = 3 * 60 * 60_000;
/** Minimal distance between "now" and the first slot, so a slot is never assigned in the last minutes. */
export const SLOT_LEAD_MS = 30 * 60_000;

/** Moscow time of the slot on a Moscow weekday (0 = Sunday), in minutes after midnight. */
export const slotMinutesMsk = weekday => (weekday >= 1 && weekday <= 4 ? 19 * 60 + 30 : 21 * 60);

/** Moscow calendar day (`YYYY-MM-DD`) of an instant. @param {string | Date} at */
export const moscowDate = at => new Date(new Date(at).getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);

/**
 * The next `count` slots strictly after `now + SLOT_LEAD_MS`, as ISO strings in UTC.
 * @param {Date} now @param {number} count @returns {string[]}
 */
export function nextSlots(now, count) {
  const earliest = now.getTime() + SLOT_LEAD_MS;
  const moscow = new Date(now.getTime() + MSK_OFFSET_MS);
  const slots = [];
  for (let day = 0; slots.length < count; day++) {
    const date = new Date(Date.UTC(moscow.getUTCFullYear(), moscow.getUTCMonth(), moscow.getUTCDate() + day));
    const at = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, slotMinutesMsk(date.getUTCDay())) - MSK_OFFSET_MS;
    if (at > earliest) slots.push(new Date(at).toISOString());
  }
  return slots;
}
