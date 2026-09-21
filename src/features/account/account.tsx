"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { BrandMark } from "../brand/brand-mark";
import { accountApi, type AuthUser, getSession, signOut, signOutEverywhere } from "../auth/client";
import { AUTH_CHANNEL, isSignOutChannelEvent, isSignOutStorageEvent } from "../auth/session-events";
import { savedStories } from "../generator/offline";
import type { GenerationJob } from "../generator/types";
import { clearOfflineScope } from "../walks/offline";
import { mergePage } from "./pagination";
import "../auth/auth.css";

type Walk = { id: string; title: string; revision: number; updatedAt: string; visibility?: "private" | "shared"; shareToken?: string | null };
type RequestItem = { jobId: string; operation: string; createdAt: string };
type Favorite = { type: string; id: string; createdAt: string };

export function Account() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [walks, setWalks] = useState<Walk[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [offlineStories, setOfflineStories] = useState<GenerationJob[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [cursors, setCursors] = useState<{ walks: string | null; requests: string | null; favorites: string | null }>({ walks: null, requests: null, favorites: null });
  const [loadingMore, setLoadingMore] = useState<"walks" | "requests" | "favorites" | null>(null);
  const [pageError, setPageError] = useState("");

  useEffect(() => {
    let active = true;
    const signedOut = () => location.replace("/login?returnTo=/account");
    const onStorage = (event: StorageEvent) => { if (isSignOutStorageEvent(event)) signedOut(); };
    const onMessage = (event: MessageEvent) => { if (isSignOutChannelEvent(event)) signedOut(); };
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel(AUTH_CHANNEL); channel.addEventListener("message", onMessage); } catch { /* Storage remains the cross-tab fallback. */ }
    addEventListener("storage", onStorage);
    void (async () => {
      try {
        const current = await getSession();
        if (!current) { signedOut(); return; }
        const [data, requestData, favoriteData, savedData] = await Promise.all([
          accountApi("/api/me/walks"), accountApi("/api/me/requests"), accountApi("/api/me/favorites"), savedStories().catch(() => []),
        ]);
        if (!active) return;
        setUser(current);
        setName(current.name);
        setWalks(data.walks);
        setRequests(requestData.requests);
        setFavorites(favoriteData.favorites);
        setCursors({ walks: data.nextCursor ?? null, requests: requestData.nextCursor ?? null, favorites: favoriteData.nextCursor ?? null });
        setOfflineStories(savedData);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Не удалось открыть кабинет.");
      }
    })();
    return () => { active = false; channel?.close(); removeEventListener("storage", onStorage); };
  }, []);

  async function loadMore(kind: "walks" | "requests" | "favorites") {
    const cursor = cursors[kind];
    if (!cursor || loadingMore) return;
    setLoadingMore(kind); setPageError("");
    try {
      const data = await accountApi(`/api/me/${kind}?cursor=${encodeURIComponent(cursor)}`);
      if (kind === "walks") setWalks(current => mergePage(current, data.walks, (item: Walk) => item.id));
      else if (kind === "requests") setRequests(current => mergePage(current, data.requests, (item: RequestItem) => `${item.jobId}:${item.createdAt}`));
      else setFavorites(current => mergePage(current, data.favorites, (item: Favorite) => `${item.type}:${item.id}`));
      setCursors(current => ({ ...current, [kind]: data.nextCursor ?? null }));
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : "Не удалось загрузить следующую страницу.");
    } finally { setLoadingMore(null); }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    try { setUser((await accountApi("/api/me", { method: "PATCH", body: JSON.stringify({ name }) })).user); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить профиль."); }
  }

  async function importDraft() {
    try {
      const raw = localStorage.getItem("otgolosok:walk:v1");
      if (!raw) throw new Error("На этом устройстве нет локального черновика.");
      const draft = JSON.parse(raw) as { title?: string };
      if (!confirm(`Перенести локальную прогулку «${draft.title || "Моя прогулка"}»? Локальная копия останется на устройстве.`)) return;
      const key = "otgolosok:account:pending-import";
      const importId = localStorage.getItem(key) || crypto.randomUUID();
      localStorage.setItem(key, importId);
      const data = await accountApi("/api/me/import", { method: "POST", body: JSON.stringify({ importId, walk: { title: draft.title || "Моя прогулка", snapshot: JSON.parse(raw) } }) });
      localStorage.removeItem(key);
      setWalks(current => [data.result.walk, ...current.filter((walk: Walk) => walk.id !== data.result.walk.id)]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось импортировать черновик."); }
  }

  function shareUrl(token: string) {
    return `${location.origin}/walk?share=${encodeURIComponent(token)}`;
  }

  async function copyLink(token: string) {
    const link = shareUrl(token);
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(link);
      setShareMessage("Ссылка скопирована в буфер обмена.");
    } catch {
      setShareMessage(`Скопируйте ссылку вручную: ${link}`);
    }
  }

  async function changeSharing(walk: Walk) {
    setSharingId(walk.id); setShareMessage(""); setError("");
    try {
      const enabled = walk.visibility !== "shared";
      const data = await accountApi(`/api/me/walks/${walk.id}/sharing`, { method: "PUT", body: JSON.stringify({ revision: walk.revision, enabled }) });
      const updated = data.walk as Walk;
      setWalks(current => current.map(item => item.id === updated.id ? updated : item));
      if (enabled && updated.shareToken) await copyLink(updated.shareToken);
      else setShareMessage("Доступ по прежней ссылке отозван.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось изменить доступ по ссылке."); }
    finally { setSharingId(null); }
  }

  async function clearPrivateOffline() {
    if (user) await clearOfflineScope(user.id).catch(() => {});
  }

  async function logout(all = false) {
    await clearPrivateOffline();
    try { await (all ? signOutEverywhere() : signOut()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Вы вышли локально."); }
    finally { localStorage.removeItem("otgolosok:account:last"); location.replace("/"); }
  }

  async function removeAccount() {
    if (!confirm("Удалить аккаунт, прогулки и избранное без возможности восстановления?")) return;
    const password = prompt("Для подтверждения введите текущий пароль:");
    if (!password) return;
    try {
      await accountApi("/api/me", { method: "DELETE", body: JSON.stringify({ password }) });
      await clearPrivateOffline();
      location.replace("/");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось удалить аккаунт."); }
  }

  const more = (kind: "walks" | "requests" | "favorites") => cursors[kind] && <button className="text-button" disabled={loadingMore !== null} onClick={() => void loadMore(kind)}>{loadingMore === kind ? "Загружаем…" : "Показать ещё"}</button>;

  return <main className="account-shell"><header><Link href="/" className="wordmark"><BrandMark /></Link></header><section className="account-panel">
    <p className="kicker">Личный кабинет</p><h1>{user?.name ?? "Загрузка…"}</h1>
    {error && <p role="alert" className="form-error">{error}</p>}
    {user && <>
      <p>{user.email}</p>
      <form onSubmit={saveProfile}><label>Имя<input value={name} onChange={event => setName(event.target.value)} maxLength={80} /></label><button className="account-button">Сохранить профиль</button></form>
      <h2>Мои прогулки</h2>
      {walks.length ? <ul className="account-list">{walks.map(walk => <li className="account-item" key={walk.id}>
        <Link href={`/walk?id=${walk.id}`}><strong>{walk.title}</strong></Link>
        <small>{new Date(walk.updatedAt).toLocaleString("ru-RU")} · {walk.visibility === "shared" ? "доступна по ссылке" : "личная"}</small>
        <div className="account-walk-actions"><Link href={`/walk?id=${walk.id}&edit=1`}>Редактировать</Link><button className="text-button" disabled={sharingId === walk.id} onClick={() => void changeSharing(walk)}>{sharingId === walk.id ? "Сохраняем…" : walk.visibility === "shared" ? "Отозвать ссылку" : "Открыть по ссылке"}</button>{walk.visibility === "shared" && walk.shareToken ? <button className="text-button" onClick={() => void copyLink(walk.shareToken!)}>Скопировать ссылку</button> : null}</div>
      </li>)}</ul> : <p>Пока нет сохранённых прогулок.</p>}
      {shareMessage && <p className="account-note" role="status">{shareMessage}</p>}
      {more("walks")}
      <h2>Сохранено на устройстве</h2>
      {offlineStories.length ? <ul className="account-list">{offlineStories.map(item => <li className="account-item" key={item.id}><Link href={`/create?job=${item.id}`}><strong>{item.story?.title || "Сохранённая история"}</strong></Link><br /><small>{item.address} · доступно без сети</small></li>)}</ul> : <p>Пока нет историй для прослушивания без сети.</p>}
      <p className="account-note">У готовой прогулки можно сохранить без сети доступные записи и текст. Частично подготовленный маршрут сохраняется честно, только с готовыми записями.</p>
      <h2>Запросы</h2>
      {requests.length ? <ul className="account-list">{requests.map(item => <li className="account-item" key={`${item.jobId}:${item.createdAt}`}><Link href={`/create?job=${item.jobId}`}>{item.operation === "walk_research" ? "Исследование прогулки" : "История"}</Link><br /><small>{new Date(item.createdAt).toLocaleString("ru-RU")}</small></li>)}</ul> : <p>Запросов пока нет.</p>}
      {more("requests")}
      <h2>Избранное</h2>
      {favorites.length ? <ul className="account-list">{favorites.map(item => <li className="account-item" key={`${item.type}:${item.id}`}>{item.type}: {item.id}</li>)}</ul> : <p>Избранного пока нет.</p>}
      {more("favorites")}
      {pageError && <p role="alert" className="form-error">{pageError}</p>}
      <div className="account-actions"><Link href="/walk" className="account-button">Собрать прогулку</Link><button className="text-button" onClick={() => void importDraft()}>Импортировать черновик с устройства</button><button className="text-button" onClick={() => void logout()}>Выйти</button><button className="text-button" onClick={() => void logout(true)}>Выйти везде</button><button className="text-button" onClick={() => void removeAccount()}>Удалить аккаунт</button></div>
    </>}
  </section></main>;
}
