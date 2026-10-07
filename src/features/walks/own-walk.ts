import { routeShortfall } from "../walk-builder/model";
import type { WalkView } from "./model";
import type { Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";

/** What the walk page adds for the viewer's own walk: the way back to the builder and its notes. */
export type OwnWalk = { editHref: string; notes: string[] };

const plural = new Intl.PluralRules("ru");

/** The builder of a walk saved on this device (`local`) or in the viewer's account (`id`). */
export function ownWalkEditHref(kind: "local" | "id", id: string) {
  return `/?${new URLSearchParams({ walk: "create", [kind]: id, edit: "1" })}`;
}

/** Builder results the walk page keeps showing: a short automatic walk and stops without a story. */
export function ownWalkNotes(view: WalkView, locale: Locale = "ru"): string[] {
  const { document } = view;
  const notes: string[] = [];
  const shortfall = document.route && !document.destination ? routeShortfall(document.route, document.minutes) : null;
  if (shortfall !== null) notes.push(translate(locale, "Рядом нашлось мест только на {shortfall} мин из {minutes}. Измените начало прогулки.", { shortfall, minutes: document.minutes }));
  const missing = view.chapters.filter(chapter => chapter.status === "not_requested").length;
  const singular = locale === "ru" ? plural.select(missing) === "one" : locale === "en" && missing === 1;
  if (missing) notes.push(translate(locale, singular ? "У {count} остановки пока нет истории." : "У {count} остановок пока нет истории.", { count: missing }));
  return notes;
}
