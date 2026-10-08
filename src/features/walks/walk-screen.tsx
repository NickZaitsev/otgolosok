"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { TourExperience } from "../tour/tour-experience";
import { creationLocation } from "../walk-builder/creation-location";
import { getLastUserId, getSession } from "../auth/client";
import { getLocalWalk, migrateLocalWalks } from "./local-store";
import { loadAccountWalk, loadCatalogWalk, loadSharedWalk, loadWalkWithOfflineCopy, localWalkView, resolveLocalWalkView, WalkLoadError, type LoadedWalk } from "./walk-loader";
import { offlineWalkRef, type OfflineWalkRef } from "./offline";
import type { WalkView } from "./model";
import type { ReviewTarget } from "../reviews/model";
import { launchesPath } from "./launches";
import { ownWalkEditHref, ownWalkNotes, type OwnWalk } from "./own-walk";
import "./walks.css";
import { toUserMessage } from "@/lib/errors/user-message";
import type { FoodPlace } from "../food/types";
import { addFoodStop } from "./add-food-stop";
import { useI18n } from "@/lib/i18n/provider";

const keys = ["new", "resume", "local", "id", "catalog", "share"] as const;
// `keys`: the addresses this walk answers to; adding a venue to someone else's walk moves the page to the copy
// without remounting the walk, so a running walk goes on. `mount` stays the same across that move.
type Loaded = { keys: string[]; mount: string; view: WalkView | null; error: string; offlineNotice: string; offlineRef: OfflineWalkRef | null };

export function WalkScreen() {
  const { languageTag, locale, path, t } = useI18n();
  const search = useSearchParams();
  const router = useRouter();
  const redirect = creationLocation(search);
  useEffect(() => { if (redirect) router.replace(path(redirect)); }, [redirect, router, path]);
  const queryKey = search.toString();
  const loadKey = `${locale}:${queryKey}`;
  const [loaded, setLoaded] = useState<Loaded>({ keys: [], mount: "", view: null, error: "", offlineNotice: "", offlineRef: null });
  const loadedRef = useRef(loaded);
  useEffect(() => { loadedRef.current = loaded; });
  const query = Object.fromEntries(keys.flatMap(key => { const value = search.get(key); return value ? [[key, value]] : []; }));
  const selected = keys.filter(key => query[key] !== undefined && !["new", "resume"].includes(key));
  const selectedKind = selected[0];
  const localId = query.local;
  const accountId = query.id;
  const catalogId = query.catalog;
  const shareToken = query.share;
  const edit = search.get("edit") === "1";
  const fromStop = search.get("fromStop");
  const createIntent = search.get("new") === "1" || search.get("resume") === "1" || search.get("address") !== null || search.get("lat") !== null || search.get("lon") !== null;
  const queryConflict = selected.length > 1 || selected.length === 1 && createIntent || search.get("new") === "1" && search.get("resume") === "1";

  useEffect(() => {
    if (!selectedKind || edit || queryConflict || loadedRef.current.keys.includes(loadKey)) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const signal = controller.signal;
        let result: LoadedWalk;
        let offlineRef: OfflineWalkRef | null;
        if (selectedKind === "local") {
          migrateLocalWalks(localStorage);
          const item = getLocalWalk(localStorage, localId);
          if (!item) throw new WalkLoadError("Локальная прогулка не найдена.", 404);
          offlineRef = offlineWalkRef("local", localId, null, locale);
          // A copy of an older revision would hide the local edits; the walk then opens without stories.
          result = await loadWalkWithOfflineCopy(inner => resolveLocalWalkView(item.document, item.revision, inner, locale), offlineRef, signal, saved => saved.revision === item.revision)
            .catch((error: unknown) => { if (signal.aborted) throw error; return { view: localWalkView(item.document, item.revision, locale), offline: false as const }; });
        } else if (selectedKind === "id") {
          const user = await getSession().catch(() => null);
          offlineRef = offlineWalkRef("id", accountId, user?.id ?? getLastUserId(), locale);
          result = await loadWalkWithOfflineCopy(inner => loadAccountWalk(accountId, inner, locale), offlineRef, signal);
        } else if (selectedKind === "catalog") {
          offlineRef = offlineWalkRef("catalog", catalogId, null, locale);
          result = await loadWalkWithOfflineCopy(inner => loadCatalogWalk(catalogId, inner, locale), offlineRef, signal);
        } else {
          offlineRef = offlineWalkRef("share", shareToken, null, locale);
          result = await loadWalkWithOfflineCopy(inner => loadSharedWalk(shareToken, inner, locale), offlineRef, signal);
        }
        const offlineNotice = result.offline ? t("Офлайн-копия от {date}. Последняя редакция может быть новее.", { date: new Date(result.savedAt).toLocaleDateString(languageTag) }) : "";
        if (!signal.aborted) setLoaded({ keys: [loadKey], mount: loadKey, view: result.view, error: "", offlineNotice, offlineRef });
      } catch (caught) {
        // A catalogue walk moved to a shared walk: its old link opens the new one.
        if (!controller.signal.aborted && caught instanceof WalkLoadError && caught.movedToShare) {
          const movedQuery = new URLSearchParams({ share: caught.movedToShare });
          if (fromStop !== null) movedQuery.set("fromStop", fromStop);
          router.replace(path(`/walk?${movedQuery}`));
          return;
        }
        if (!controller.signal.aborted) setLoaded({ keys: [loadKey], mount: loadKey, view: null, error: toUserMessage(caught, "Не удалось открыть прогулку.", locale), offlineNotice: "", offlineRef: null });
      }
    })();
    return () => controller.abort();
  }, [queryKey, loadKey, selectedKind, localId, accountId, catalogId, shareToken, edit, queryConflict, router, fromStop, languageTag, locale, path, t]);

  const sourceId = selectedKind === "local" ? localId : selectedKind === "id" ? accountId : selectedKind === "catalog" ? catalogId : shareToken;
  const addFood = useCallback(async (place: FoodPlace, signal: AbortSignal) => {
    const view = loadedRef.current.view;
    if (!view || !(selectedKind === "local" || selectedKind === "id" || selectedKind === "catalog" || selectedKind === "share")) throw new Error("Прогулка ещё не открыта.");
    const result = await addFoodStop(view, { kind: selectedKind, id: sourceId }, place, signal);
    if (!result.moved) {
      setLoaded(value => ({ ...value, view: result.view, offlineNotice: "" }));
      return "";
    }
    const { kind, id } = result.moved;
    const nextQuery = new URLSearchParams({ [kind]: id });
    // Keep the selected entry even if a changed walk removed it: the validation below then explains the error.
    if (fromStop !== null) nextQuery.set("fromStop", fromStop);
    const nextKey = nextQuery.toString();
    const nextLoadKey = `${locale}:${nextKey}`;
    const user = kind === "id" ? getLastUserId() : null;
    setLoaded(value => ({ ...value, keys: [...value.keys, nextLoadKey], view: result.view, offlineNotice: "", offlineRef: offlineWalkRef(kind, id, user, locale) }));
    // The native History API keeps the page mounted; Next.js syncs useSearchParams with it.
    window.history.replaceState(null, "", path(`/walk?${nextKey}`));
    return t(kind === "id" ? "Копия прогулки сохранена в «Моих прогулках»." : "Копия прогулки сохранена на этом устройстве.");
  }, [selectedKind, sourceId, fromStop, locale, path, t]);

  if (queryConflict) return <WalkError message={t("Ссылка содержит конфликтующие параметры.")} />;
  if (edit && (selected.length !== 1 || !["local", "id"].includes(selected[0]))) return <WalkError message={t("Редактировать можно только свою прогулку.")} />;
  if (selected.length === 1 && edit) return <p role="status">{t("Открываем карту…")}</p>;
  if (createIntent) return <p role="status">{t("Открываем карту…")}</p>;
  if (selected.length === 0) return <p role="status">{t("Открываем историю…")}</p>;
  const current = loaded.keys.includes(loadKey) ? loaded : null;
  // Local guest walks exist only in this browser, so the server cannot accept reviews for them.
  const reviewTarget: ReviewTarget | null = selectedKind === "catalog" ? { kind: "catalog", id: catalogId }
    : selectedKind === "share" ? { kind: "share", token: shareToken }
    : selectedKind === "id" ? { kind: "account", id: accountId } : null;
  if (current?.error) return <WalkError message={current.error} />;
  if (!current?.view) return <main className="walk-screen"><p role="status">{t("Открываем прогулку…")}</p></main>;
  if (fromStop !== null && !current.view.document.stops.some(stop => stop.id === fromStop)) return <WalkError message={t("Точка начала больше не входит в эту прогулку. Откройте подборку заново.")} />;
  // Only walks saved on this device or in the viewer's account lead back to the builder.
  const own: OwnWalk | null = selectedKind === "local" ? { editHref: path(ownWalkEditHref("local", localId)), notes: ownWalkNotes(current.view, locale) }
    : selectedKind === "id" ? { editHref: path(ownWalkEditHref("id", accountId)), notes: ownWalkNotes(current.view, locale) } : null;
  return <TourExperience key={current.mount} walk={current.view} fromStop={fromStop} onAddFood={addFood} offline={current.offlineRef} offlineNotice={current.offlineNotice} reviewTarget={reviewTarget} launchTarget={launchesPath(reviewTarget) ? reviewTarget : null} own={own} />;
}

function WalkError({ message }: { message: string }) {
  const { path, t } = useI18n();
  return <main className="walk-screen"><p className="walk-warning" role="alert">{message}</p><a href={path("/account/walks")}>{t("Вернуться к прогулкам")}</a></main>;
}
