"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSession, accountApi, type AuthUser } from "../auth/client";
import { listLocalWalks, migrateLocalWalks, type LocalWalkItem } from "./local-store";
import type { WalkCard } from "./walk-loader";
import { loadCatalogCards } from "./walk-loader";
import "./walks.css";

export function WalkLibrary() {
  const [local, setLocal] = useState<LocalWalkItem[]>([]);
  const [account, setAccount] = useState<WalkCard[]>([]);
  const [catalog, setCatalog] = useState<WalkCard[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const migrated = migrateLocalWalks(localStorage);
        setLocal(listLocalWalks(localStorage));
        const [catalogCards, current] = await Promise.all([
          loadCatalogCards(controller.signal).catch(() => []),
          getSession().catch(() => null),
        ]);
        if (controller.signal.aborted) return;
        setCatalog(catalogCards);
        setUser(current);
        if (current) {
          const data = await accountApi("/api/me/walks");
          if (!controller.signal.aborted) setAccount((data.walks as Array<WalkCard & { kind?: string }>).map(item => ({ ...item, kind: "account" })));
        }
        if (migrated) setLocal(listLocalWalks(localStorage));
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Не удалось открыть библиотеку прогулок.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  return <main className="walk-library">
    <header className="walk-library-header"><div><p className="kicker">Отголосок</p><h1>Прогулки</h1><p>Соберите маршрут, сохраните его и слушайте готовые части в своём темпе.</p></div><Link className="walk-primary" href="/walk?new=1">Собрать прогулку</Link></header>
    {error ? <p className="walk-warning" role="alert">{error}</p> : null}
    {loading ? <p role="status">Открываем библиотеку…</p> : <>
      <WalkSection title="На устройстве" empty="Здесь появятся прогулки, сохранённые без входа." cards={local.map(item => ({ id: item.document.id, title: item.document.title, subtitle: item.document.description, revision: item.revision, kind: "local" as const }))} />
      {user ? <WalkSection title="В аккаунте" empty="Сохранённых прогулок пока нет." cards={account} /> : <section className="walk-library-note"><h2>Сохраняйте между устройствами</h2><p>Войдите, чтобы сохранить прогулку в аккаунте и включить доступ по ссылке.</p><Link href="/login?returnTo=/walk">Войти в аккаунт</Link></section>}
      <WalkSection title="Пример" empty="Начальные прогулки пока недоступны." cards={catalog} />
    </>}
  </main>;
}

function WalkSection({ title, empty, cards }: { title: string; empty: string; cards: WalkCard[] }) {
  return <section className="walk-library-section" aria-labelledby={`walk-section-${title}`}>
    <h2 id={`walk-section-${title}`}>{title}</h2>
    {cards.length ? <ul className="walk-library-list">{cards.map(card => <li key={`${card.kind}:${card.id}`}><Link href={card.kind === "local" ? `/walk?local=${encodeURIComponent(card.id)}` : card.kind === "catalog" ? `/walk?catalog=${encodeURIComponent(card.id)}` : `/walk?id=${encodeURIComponent(card.id)}`}><strong>{card.title}</strong><span>{card.subtitle || (card.kind === "catalog" ? "Готовая редакторская прогулка" : card.kind === "local" ? "Локальная копия" : "Личная прогулка")}</span>{card.updatedAt ? <small>Обновлено {new Date(card.updatedAt).toLocaleDateString("ru-RU")}</small> : null}</Link></li>)}</ul> : <p className="walk-library-empty">{empty}</p>}
  </section>;
}
