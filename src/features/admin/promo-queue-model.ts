// Promo queue shared by the admin list of user walks and the queue tab.

export type PromoStatus = "queued" | "building" | "ready" | "published" | "failed" | "cancelled";
export type PromoState = { status: PromoStatus; slotAt: string | null; youtubeUrl: string | null };
export type PromoItem = {
  id: string; walkId: string; title: string; shareToken: string | null; visibility: string | null;
  position: number; status: PromoStatus; slotAt: string | null; runId: string | null;
  youtubeUrl: string | null; telegramUrl: string | null; error: string | null; revision: number;
  createdAt: string; updatedAt: string;
};
export type PromoQueue = { items: PromoItem[]; history: PromoItem[] };

export const promoStatusLabels: Record<PromoStatus, string> = {
  queued: "в очереди", building: "собирается", ready: "готов к выходу",
  published: "опубликован", failed: "ошибка", cancelled: "отменён",
};

/** Slot time in Moscow, the time zone of the schedule, whatever the browser's zone is. */
export function slotLabel(slotAt: string | null) {
  if (!slotAt) return "время не назначено";
  return new Date(slotAt).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }) + " МСК";
}

/** The admin column in words: status and the planned or past slot. */
export function promoText(promo: PromoState | null) {
  if (!promo) return "Без промо";
  if (promo.status === "published") return "Опубликован";
  return `${promoStatusLabels[promo.status]} · ${slotLabel(promo.slotAt)}`;
}

/** A walk can be queued only without an active or published promo: one walk gets one issue. */
export const canEnqueue = (promo: PromoState | null) => !promo;

/** Link-only walks become public through YouTube and Telegram: the editor confirms it. */
export const PROMO_LINK_ONLY_WARNING =
  "Прогулка доступна только по ссылке. В промо ссылка станет публичной в YouTube и Telegram. Поставить в очередь?";

/** Describe the failed stage without exposing provider payloads or hiding its diagnostic code. */
export function promoErrorText(code: string) {
  const explanations: Record<string, string> = {
    SUBTITLE_TRANSLATION: "Перевод субтитров не прошёл проверку. Нужно исправить перевод и повторить сборку.",
    SCRIPT_INVALID: "Сценарий не прошёл проверку. Нужно проверить факты и заново подготовить сценарий.",
    PHOTO_MISSING: "Не хватает фотографий для ролика. Добавьте фото к историям прогулки перед повторной сборкой.",
    WALK_NOT_SHARED: "Прогулка больше не доступна по ссылке. Откройте доступ перед возвратом в очередь.",
    WALK_START: "Начало маршрута не прошло проверку. Проверьте первую остановку прогулки перед повторной сборкой.",
    PROMO_SLOT_MISSED: "Время публикации пропущено. Верните выпуск в очередь для нового слота.",
    PROMO_POST_NO_STORY: "Нет отдельной истории для поста. Добавьте историю, которая не используется в ролике.",
    PROMO_POST_INVALID: "Пост не прошёл проверку. Нужно исправить текст и повторить сборку.",
    IMAGE_CONTRACT: "Иллюстрация не прошла проверку. Нужно заново подготовить изображение.",
    YOUTUBE_REJECTED: "YouTube отклонил ролик. Проверьте причину отказа в журнале генератора перед повтором.",
    INTERNAL: "Внутренняя ошибка генератора. Проверьте журнал прогона перед повторной сборкой.",
  };
  return explanations[code] ?? "Не удалось подготовить или опубликовать выпуск. Проверьте журнал прогона по коду ошибки перед возвратом в очередь.";
}
