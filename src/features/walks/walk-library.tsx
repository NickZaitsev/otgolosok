"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getSession, accountApi } from "../auth/client";
import { listLocalWalks, migrateLocalWalks } from "./local-store";
import type { WalkCard } from "./walk-loader";
import { AccessDialog, accessLabel } from "./access-dialog";
import { TopWalks } from "./top-walks";
import { AppHeader } from "../navigation/app-header";
import { mergePage } from "../account/pagination";
import "./history.css";
import styles from "./walk-library.module.css";
import { toUserMessage } from "@/lib/errors/user-message";
import { useI18n } from "@/lib/i18n/provider";
type Card = WalkCard & { distanceM?: number; walkingMinutes?: number; draft?: boolean };
type Tab = "mine" | "top";
const TABS: Array<{ id: Tab; title: string }> = [{ id: "mine", title: "Мои прогулки" }, { id: "top", title: "Топ прогулок" }];

/**
 * `?tab=` wins; otherwise «Мои» once own walks have loaded, or «Топ» for a viewer with none.
 * A failed load is not «no walks»: «Мои» stays open so its error and retry remain visible.
 */
export function selectedTab(param: string | null, loading: boolean, ownCount: number, failed = false): Tab | null {
  if (param === "top" || param === "mine") return param;
  if (loading) return null;
  return ownCount || failed ? "mine" : "top";
}

export function WalkLibrary({ mode = "all" }: { mode?: "all" | "mine" }) {
  const { languageTag, locale, path, t } = useI18n();
  const params = useSearchParams();
  const [local, setLocal] = useState<Card[]>([]);
  const [account, setAccount] = useState<Card[]>([]);
  const [guest, setGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<"all" | "draft">("all");
  const [accessCard, setAccessCard] = useState<Card | null>(null);
  const [topOpened, setTopOpened] = useState(false);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ mine: null, top: null });
  useEffect(() => {
    let active = true;
    const fail = (key: string, caught: unknown) => { if (active) setErrors(current => ({ ...current, [key]: toUserMessage(caught, "Не удалось открыть прогулки.", locale) })); };
    void (async () => {
      try {
        migrateLocalWalks(localStorage);
        setLocal(listLocalWalks(localStorage).map(item => ({ id: item.document.id, title: item.document.title, subtitle: item.document.description, revision: item.revision, kind: "local", updatedAt: item.updatedAt, draft: !item.document.route, distanceM: item.document.route?.distanceM, travelMode: item.document.travelMode ?? "walking", totalMinutes: item.document.route?.car?.totalMinutes ?? item.document.route?.walkingMinutes, walkingMinutes: item.document.route?.walkingMinutes })));
      } catch (caught) { fail("local", caught); }
      await (async () => {
        const user = await getSession(); if (!active) return; setGuest(!user);
        if (user) { const data = await accountApi("/api/me/walks"); if (!active) return; setAccount(data.walks.map((card: WalkCard) => ({ ...card, kind: "account" }))); setCursor(data.nextCursor ?? null); }
      })().catch(caught => fail("account", caught));
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [attempt, locale]);
  async function more() {
    if (!cursor || busy) return; setBusy("page");
    try {
      const data = await accountApi(`/api/me/walks?cursor=${encodeURIComponent(cursor)}`);
      setAccount(current => mergePage(current, data.walks.map((item: WalkCard) => ({ ...item, kind: "account" })), (item: Card) => item.id)); setCursor(data.nextCursor ?? null);
    } catch (caught) { setErrors(current => ({ ...current, page: toUserMessage(caught, "Не удалось загрузить следующую страницу.", locale) })); }
    finally { setBusy(null); }
  }
  async function copy(token: string, done = t("Ссылка скопирована.")) {
    const url = `${location.origin}${path(`/walk?share=${encodeURIComponent(token)}`)}`;
    try { await navigator.clipboard.writeText(url); setNotice(done); } catch { setNotice(t("Скопируйте ссылку: {url}", { url })); }
  }
  async function accessSaved(previous: Card, walk: WalkCard) {
    setAccessCard(null);
    setAccount(current => current.map(item => item.id === previous.id ? { ...item, ...walk, kind: "account" } : item));
    if (!walk.shareToken) { setNotice(t("Доступ закрыт: прогулку видите только вы.")); return; }
    const awaitsReview = walk.visibility === "public" && walk.listingStatus === "pending" && !(previous.visibility === "public" && previous.listingStatus === "pending");
    await copy(walk.shareToken, t(awaitsReview ? "Ссылка скопирована. Прогулка появится в топе после проверки." : "Ссылка скопирована."));
  }
  const cards = [...account, ...local].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const visible = cards.filter(card => filter === "all" || card.draft);
  const tab = mode === "mine" ? "mine" : selectedTab(params.get("tab"), loading, cards.length, Object.keys(errors).length > 0);
  // The top loads lazily on its first open and stays mounted afterwards.
  if (tab === "top" && !topOpened) setTopOpened(true);
  function selectTab(next: Tab, focus = false) {
    // replaceState integrates with the Next.js router, so useSearchParams follows it without a navigation.
    // The state must be null: Next.js ignores calls that carry its own internal state (`__NA`).
    const url = new URL(location.href);
    url.searchParams.set("tab", next);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (focus) tabRefs.current[next]?.focus();
  }
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>) {
    const index = Math.max(0, TABS.findIndex(item => item.id === tab));
    const next = event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length] : event.key === "ArrowLeft" ? TABS[(index - 1 + TABS.length) % TABS.length]
      : event.key === "Home" ? TABS[0] : event.key === "End" ? TABS[TABS.length - 1] : null;
    if (!next) return;
    event.preventDefault();
    selectTab(next.id, true);
  }
  return <main className="ui-page history-page"><AppHeader />
    <header className="history-heading"><div>{mode === "mine" ? <Link className="ui-eyebrow" href={path("/account")}>{t("Профиль")}</Link> : <p className="ui-eyebrow">{t("Ваши маршруты")}</p>}<h1>{t(mode === "mine" ? "Мои прогулки" : "История прогулок")}</h1><p className="ui-muted">{t(mode === "mine" ? "Сохранённые маршруты и черновики" : "Знакомые места. Новые открытия. Всё, к чему хочется вернуться.")}</p></div></header>
    {mode === "all" ? <div role="tablist" aria-label={t("Прогулки")} className={styles.tabs}>
      {TABS.map(item => <button key={item.id} ref={element => { tabRefs.current[item.id] = element; }} type="button" role="tab" id={`history-tab-${item.id}`}
        aria-selected={tab === item.id} aria-controls={`history-panel-${item.id}`} tabIndex={tab === item.id || (tab === null && item.id === "mine") ? 0 : -1}
        className={styles.tab} onClick={() => selectTab(item.id)} onKeyDown={tabKeys}>{t(item.title)}</button>)}
    </div> : null}
    <section role={mode === "all" ? "tabpanel" : undefined} id="history-panel-mine" aria-labelledby={mode === "all" ? "history-tab-mine" : undefined} hidden={tab === "top"}>
      <div className={styles.toolbar}><div className="history-filters"><button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("Все прогулки")}</button><button aria-pressed={filter === "draft"} onClick={() => setFilter("draft")}>{t("Черновики")}</button></div><Link href={path("/?walk=create")} className="ui-button">{t("Новая прогулка")} <span aria-hidden="true">＋</span></Link></div>
      {Object.entries(errors).map(([key, message]) => <p key={key} role="alert" className="ui-notice">{message} <button className="history-retry" onClick={() => { setErrors({}); setLoading(true); setAttempt(value => value + 1); }}>{t("Повторить")}</button></p>)}
      {loading ? <p role="status" className="ui-muted">{t("Загружаем ваши прогулки…")}</p> : <>
        {visible.length ? <ul className="history-grid">{visible.map(card => <li key={`${card.kind}:${card.id}`}><article className="history-card"><div className="history-card-body">
          <span className="history-badge">{t(card.draft ? "Черновик" : card.kind === "local" ? "На устройстве" : "В аккаунте")}</span>
          <Link className="history-card-title" href={path(`/walk?${card.kind === "local" ? "local" : "id"}=${encodeURIComponent(card.id)}`)}><h2>{card.title}</h2></Link>
          {card.subtitle && <p>{card.subtitle}</p>}
          <p className="ui-muted">{[
            card.travelMode === "driving" ? t("На машине · {minutes} мин", { minutes: card.totalMinutes ?? 0 }) : card.walkingMinutes ? t("{minutes} мин пешком", { minutes: card.walkingMinutes }) : null,
            card.distanceM ? t("{distance} км", { distance: (card.distanceM / 1000).toLocaleString(languageTag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : null,
            card.updatedAt ? new Date(card.updatedAt).toLocaleDateString(languageTag) : null,
          ].filter(Boolean).join(" · ")}</p>
          {card.kind === "account" && <p className={styles.access}>{t("Доступ: {access}", { access: accessLabel(card, locale) })}</p>}
          <div className="history-actions">
            <Link href={path(`/?walk=create&${card.kind === "local" ? "local" : "id"}=${encodeURIComponent(card.id)}&edit=1`)}>{t("Редактировать")}</Link>
            {card.kind === "account" && <button disabled={busy !== null} aria-haspopup="dialog" onClick={() => { setNotice(""); setAccessCard(card); }}>{t("Доступ")}</button>}
            {card.shareToken && <button onClick={() => void copy(card.shareToken!)}>{t("Скопировать ссылку")}</button>}
          </div>
        </div></article></li>)}</ul> : <section className="history-empty"><span aria-hidden="true">↗</span><h2>{t(filter === "draft" ? "Нет незаконченных прогулок" : "Начните свою историю города")}</h2><p>{t("Выберите дом на карте или задайте начало маршрута.")}{" "}<br />{t("Сохранённые прогулки появятся здесь.")}</p><Link className="ui-button" href={path("/?walk=create")}>{t("Создать прогулку")}</Link></section>}
        {cursor && <button className="ui-button secondary" disabled={busy !== null} onClick={() => void more()}>{t("Показать ещё")}</button>}
        {notice && <p className="ui-notice" role="status">{notice}</p>}
        {guest && <aside className="history-signin"><div><h2>{t("Ваши прогулки — с вами")}</h2><p>{t("Войдите, чтобы открывать их на других устройствах и делиться ссылками.")}</p></div><Link className="ui-button quiet" href={path(`/login?returnTo=${encodeURIComponent(path(mode === "mine" ? "/account/walks" : "/history"))}`)}>{t("Войти")}</Link></aside>}
      </>}
    </section>
    {mode === "all" ? <section role="tabpanel" id="history-panel-top" aria-labelledby="history-tab-top" hidden={tab !== "top"}>
      {topOpened && <TopWalks />}
    </section> : null}
    <AccessDialog card={accessCard} onClose={() => setAccessCard(null)} onSaved={walk => { if (accessCard) void accessSaved(accessCard, walk); }} />
  </main>;
}
