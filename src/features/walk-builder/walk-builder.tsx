"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { ExploreMap } from "../explore/explore-map";
import { placeFromQuery, rememberMapJob } from "../explore/map-jobs";
import { jobUrl } from "../generator/offline";
import { stageLabels, terminalStages, type GenerationJob } from "../generator/types";
import type { Coordinates } from "../tour/types";
import { DRAFT_KEY, editDraft, emptyDraft, isJobId, isPlace, isPlan, isStage, moveStop, parseDraft, placeKey, rememberStory, storyAddressKey, saveDraft, validStops, type Draft, type Place } from "./model";
import "../explore/explore.css";
import "./walk-builder.css";

class RejectedRequest extends Error {}

async function request(path: string, signal: AbortSignal, body?: object): Promise<unknown> {
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal.addEventListener("abort", relay, { once: true });
  if (signal.aborted) relay();
  const timer = setTimeout(relay, 20000);
  try {
    const response = await fetch(path, { signal: controller.signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) {
      const ErrorType = response.status >= 400 && response.status < 500 ? RejectedRequest : Error;
      throw new ErrorType(value.error?.message ?? (response.status === 503 ? "Пешеходный маршрутизатор пока недоступен. Попробуйте позже." : "Сервис недоступен. Повторите действие позже."));
    }
    return value;
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new Error("Время ожидания истекло. Проверьте соединение.");
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", relay); }
}
function readJob(value: unknown): GenerationJob {
  if (!value || typeof value !== "object" || !("id" in value) || !("stage" in value) || !isJobId(value.id) || !isStage(value.stage)) throw new Error("Не удалось прочитать состояние истории.");
  return value as GenerationJob;
}

export function WalkBuilder() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const current = useRef(draft);
  const stored = useRef<string | null>(null);
  const writable = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const action = useRef<AbortController | null>(null);
  const [candidate, setCandidate] = useState<Place | null>(null);
  const [target, setTarget] = useState<"start" | "stop">("start");
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<Coordinates | null>(null);
  const [selection, setSelection] = useState<"auto" | "manual">("auto");
  const [reviewed, setReviewed] = useState(false);
  const [pollId, setPollId] = useState<string | null>(null);
  const [recoveryId, setRecoveryId] = useState("");
  const statusRequest = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);

  useEffect(() => {
    try {
      stored.current = localStorage.getItem(DRAFT_KEY);
      const restored = parseDraft(stored.current);
      current.current = restored; setDraft(restored); writable.current = true;
      setSelection(restored.stops.length ? "manual" : "auto");
      setFocus(restored.start?.location ?? null);
    } catch (caught) { setStorageError(caught instanceof Error ? caught.message : "Хранилище недоступно. Черновик не записан."); }
    const incoming = placeFromQuery(new URLSearchParams(window.location.search));
    if (isPlace(incoming)) { setCandidate(incoming); setFocus(incoming.location); }
    setLoaded(true);
    return () => { action.current?.abort(); statusRequest.current?.controller.abort(); statusRequest.current = null; };
  }, []);

  function persist(next: Draft) {
    current.current = next; setDraft(next);
    if (!writable.current) return false;
    try {
      stored.current = saveDraft(localStorage, next, stored.current);
      setStorageError(""); return true;
    } catch (caught) {
      writable.current = false;
      setStorageError(caught instanceof Error ? caught.message : "Не удалось сохранить. Не закрывайте страницу; скачайте копию.");
      return false;
    }
  }
  function edit(change: Parameters<typeof editDraft>[1]) {
    setReviewed(false); setError(""); setMessage("");
    if (change.stops) setSelection("manual");
    persist(editDraft(current.current, change));
  }

  function refreshJobs(): Promise<void> {
    if (statusRequest.current) return statusRequest.current.promise;
    const controller = new AbortController();
    const promise = (async () => {
      const updates = new Map<string, GenerationJob>();
      for (const id of new Set(current.current.jobs.map(j => j.id))) {
        const job = readJob(await request(jobUrl(id), controller.signal));
        controller.signal.throwIfAborted();
        if (job.id !== id) throw new Error("Сервис вернул другую историю.");
        updates.set(id, job);
      }
      controller.signal.throwIfAborted();
      if (updates.size && !persist({ ...current.current, jobs: current.current.jobs.map(j => ({ ...j, stage: updates.get(j.id)?.stage ?? j.stage })) })) throw new Error("Не удалось сохранить обновлённые статусы.");
    })().finally(() => { if (statusRequest.current?.controller === controller) statusRequest.current = null; });
    statusRequest.current = { controller, promise };
    return promise;
  }
  const refreshOnFocus = useEffectEvent(() => {
    if (action.current || !writable.current) return;
    void refreshJobs().catch(caught => {
      if (caught instanceof Error && caught.name !== "AbortError") setError(caught.message);
    });
  });
  useEffect(() => {
    if (!loaded) return;
    refreshOnFocus();
    const focus = () => refreshOnFocus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [loaded]);

  const refreshForPoll = useEffectEvent(refreshJobs);
  // Refresh is GET-only, including terminal jobs retried in the linked generator.
  useEffect(() => {
    if (!pollId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (action.current) { timer = setTimeout(() => void poll(), 3000); return; }
        await refreshForPoll();
        if (controller.signal.aborted) return;
        const job = current.current.jobs.find(j => j.id === pollId);
        if (!job || terminalStages.has(job.stage)) { setPollId(null); return; }
        timer = setTimeout(() => void poll(), 3000);
      } catch (caught) {
        if (!controller.signal.aborted) { setError(caught instanceof Error ? caught.message : "Связь прервалась. Обновите статус кнопкой."); setPollId(null); }
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pollId]);

  async function resolve(value: Coordinates | string) {
    if (action.current) return;
    setReviewed(false); setCandidate(null); setError("");
    const controller = new AbortController(); action.current = controller; setBusy("Ищем адрес…");
    try {
      const params = new URLSearchParams(typeof value === "string" ? { q: value } : { lat: String(value.lat), lon: String(value.lon) });
      const found = await request(`/api/story-place?${params}`, controller.signal);
      if (controller.signal.aborted) return;
      if (!isPlace(found)) throw new Error("Не найден точный адрес дома в Москве. Уточните улицу и номер.");
      const place = { address: found.address, location: { lat: found.location.lat, lon: found.location.lon } };
      setCandidate(place); setFocus(place.location);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Не удалось найти адрес."); }
    finally { if (!controller.signal.aborted) { action.current = null; setBusy(""); } }
  }
  function confirmPlace() {
    if (!candidate) return;
    if (target === "start") edit({ start: candidate });
    else {
      const stops = [...draft.stops, candidate];
      if (!validStops(draft.start, stops)) { setError("Добавьте от 1 до 5 разных домов, не ближе 25 м к старту и друг к другу."); return; }
      edit({ stops }); setSelection("manual");
    }
    setCandidate(null); setQuery("");
  }
  async function plan() {
    if (!draft.start || action.current || candidate) return;
    const snapshot = current.current;
    const controller = new AbortController(); action.current = controller; setBusy("Строим пешеходный маршрут…");
    setReviewed(false); setError(""); persist({ ...snapshot, route: null });
    try {
      const result = await request("/api/walk-plan", controller.signal, { start: snapshot.start, mode: snapshot.mode, minutes: snapshot.minutes, ...(selection === "manual" ? { stops: snapshot.stops } : {}) });
      if (controller.signal.aborted) return;
      if (!isPlan(result) || !validStops(snapshot.start, result.stops) || result.walkingMinutes > snapshot.minutes || (selection === "manual" && JSON.stringify(result.stops) !== JSON.stringify(snapshot.stops))) throw new Error("Сервис вернул некорректный маршрут. Попробуйте построить заново.");
      persist({ ...current.current, stops: result.stops, route: result }); setSelection("manual");
      setMessage("Маршрут построен. Проверьте линию на карте и порядок остановок.");
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Маршрут недоступен."); }
    finally { if (!controller.signal.aborted) { action.current = null; setBusy(""); } }
  }
  const places = draft.start ? [draft.start, ...draft.stops] : [];
  const nextPlace = places.find(p => !draft.jobs.some(j => storyAddressKey(j.place.address) === storyAddressKey(p.address)));
  const activeJob = draft.jobs.find(j => !terminalStages.has(j.stage));
  async function prepareNext() {
    if (action.current || !reviewed || !draft.route || candidate || !nextPlace || activeJob || draft.submitting || !writable.current) return;
    const controller = new AbortController(); action.current = controller; setBusy("Создаём одну историю…"); setError("");
    try {
      await refreshJobs();
      controller.signal.throwIfAborted();
      if (current.current.jobs.some(j => !terminalStages.has(j.stage))) {
        setMessage("Другая история ещё готовится, возможно после повтора. Дождитесь завершения."); return;
      }
      // Record the intent only after revalidating every known job, before POST.
      if (!persist({ ...current.current, submitting: nextPlace })) return;
      const job = readJob(await request("/api/story-jobs", controller.signal, { address: nextPlace.address }));
      if (controller.signal.aborted) return;
      const saved = persist({ ...current.current, submitting: null, jobs: rememberStory(current.current.jobs, { place: nextPlace, id: job.id, stage: job.stage }) });
      rememberMapJob(job, nextPlace);
      if (saved && !terminalStages.has(job.stage)) setPollId(job.id);
      setMessage("Ссылка на историю сохранена. Следующую можно подготовить после завершения этой.");
    } catch (caught) {
      if (!controller.signal.aborted) {
        if (caught instanceof RejectedRequest) {
          persist({ ...current.current, submitting: null });
          setError(caught.message);
        } else setError(`${caught instanceof Error ? caught.message : "Запрос прервался."} ${current.current.submitting ? "Результат отправки неизвестен. Не повторяем её автоматически." : "Новая история не отправлена. Обновите статусы и повторите действие."}`);
      }
    }
    finally { if (!controller.signal.aborted) { action.current = null; setBusy(""); } }
  }
  async function recoverJob() {
    if (!draft.submitting || !isJobId(recoveryId) || action.current) return;
    const controller = new AbortController(); action.current = controller; setBusy("Проверяем историю…"); setError("");
    try {
      await refreshJobs();
      controller.signal.throwIfAborted();
      const job = readJob(await request(jobUrl(recoveryId), controller.signal));
      if (controller.signal.aborted) return;
      if (job.id !== recoveryId || typeof job.address !== "string" || storyAddressKey(job.address) !== storyAddressKey(draft.submitting.address)) throw new Error("История относится к другому адресу.");
      persist({ ...current.current, submitting: null, jobs: rememberStory(current.current.jobs, { place: draft.submitting, id: job.id, stage: job.stage }) });
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Не удалось проверить историю."); }
    finally { if (!controller.signal.aborted) { action.current = null; setBusy(""); } }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current.current, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "otgolosok-walk.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!loaded) return <main className="walk-builder"><p role="status">Открываем вашу прогулку…</p></main>;
  const locked = !!busy;
  return <main className="walk-builder">
    <header><Link href="/" prefetch={false}>отголосок<span>.</span></Link><Link href="/" prefetch={false}>На карту</Link></header>
    <h1>Ваша прогулка</h1>
    <p>Выберите начало, соберите маршрут и только потом подготовьте истории. Пока доступны адреса Москвы.</p>
    <Link href="/create?new=1" prefetch={false}>Нужна только история одного дома?</Link>
    {storageError ? <section className="walk-warning" role="alert"><h2>Черновик не сохранён</h2><p>{storageError}</p><p>Исходную запись не перезаписываем. Подготовка историй заблокирована. Скачайте текущую версию перед перезагрузкой.</p><button onClick={download}>Скачать текущий черновик</button></section> : <p className="walk-muted">Черновик сохраняется только в этом браузере. Вернуться: «Прогулка» → «Моя прогулка».</p>}
    <label className="walk-field">Название<input maxLength={120} value={draft.title} disabled={locked} onChange={e => persist({ ...current.current, title: e.target.value })} /></label>
    <section aria-labelledby="walk-start"><h2 id="walk-start">Начало и остановки</h2>
      <p>{draft.start ? <>Начало подтверждено: <strong>{draft.start.address}</strong></> : "Выберите дом на карте или найдите адрес. Затем подтвердите точку начала."}</p>
      <fieldset disabled={locked}><legend>Что выбираем на карте или по адресу</legend><div className="walk-options"><label><input type="radio" name="target" checked={target === "start"} onChange={() => { setTarget("start"); setCandidate(null); setReviewed(false); }} /> Начало</label><label><input type="radio" name="target" checked={target === "stop"} disabled={!draft.start || draft.stops.length >= 5} onChange={() => { setTarget("stop"); setCandidate(null); setReviewed(false); }} /> Остановку</label></div></fieldset>
      <form onSubmit={e => { e.preventDefault(); void resolve(query.trim()); }}><label className="walk-field">Адрес дома<input value={query} onChange={e => { setQuery(e.target.value); setCandidate(null); setReviewed(false); }} minLength={6} maxLength={180} required disabled={locked} placeholder="Москва, улица и номер дома" /></label><button disabled={locked || query.trim().length < 6}>Найти адрес</button></form>
      <p className="walk-muted">Выбранная точка или адрес отправляются для поиска адреса. Карта OpenStreetMap требует интернета. Истории при выборе точки не создаются.</p>
      <div className="walk-map" aria-busy={locked}><ExploreMap items={[...places.map((p, i) => ({ id: String(i), title: i === 0 ? `Начало: ${p.address}` : p.address, location: p.location, number: i + 1 })), ...(candidate ? [{ id: "candidate", title: candidate.address, location: candidate.location, pending: true }] : [])]} selectedId={candidate ? "candidate" : undefined} focus={focus} user={null} geometry={draft.route?.geometry} mapLabel="Карта прогулки. Выберите начало или остановку. Адрес также можно ввести в форме." onSelect={id => { const p = places[Number(id)]; if (p && !locked) setFocus({ ...p.location }); }} onPoint={point => { if (!locked) void resolve(point); }} /></div>
      {candidate ? <div className="walk-candidate"><p><strong>{candidate.address}</strong></p>{draft.start && target === "start" ? <p>Подтверждение заменит начало сохранённой прогулки. Маршрут потребуется перестроить; ссылки на истории сохранятся.</p> : null}<button disabled={locked} onClick={confirmPlace}>{target === "start" ? "Подтвердить начало здесь" : "Добавить остановку"}</button><button disabled={locked} onClick={() => setCandidate(null)}>Отменить выбор</button></div> : null}
    </section>
    <section aria-labelledby="walk-route"><h2 id="walk-route">Куда пойдём</h2>
      <fieldset disabled={locked}><legend>Остановки</legend><div className="walk-options">{(["auto", "manual"] as const).map(value => <label key={value}><input type="radio" name="selection" checked={selection === value} onChange={() => { setSelection(value); edit({}); }} />{value === "auto" ? "Подобрать автоматически" : "Выбрать вручную"}</label>)}</div></fieldset>
      <p>От 1 до 5 остановок после начала. Автоматический подбор можно отредактировать и перестроить.</p>
      {draft.stops.length ? <ol className="walk-stops">{draft.stops.map((p, i) => <li key={placeKey(p)}><strong>{p.address}</strong><div className="walk-actions"><button disabled={locked || i === 0} aria-label={`Поднять остановку ${i + 1}: ${p.address}`} onClick={() => edit({ stops: moveStop(draft.stops, i, -1) })}>Выше</button><button disabled={locked || i === draft.stops.length - 1} aria-label={`Опустить остановку ${i + 1}: ${p.address}`} onClick={() => edit({ stops: moveStop(draft.stops, i, 1) })}>Ниже</button><button disabled={locked} aria-label={`Удалить остановку ${i + 1}: ${p.address}`} onClick={() => edit({ stops: draft.stops.filter((_, index) => index !== i) })}>Удалить</button></div></li>)}</ol> : null}
      <fieldset disabled={locked}><legend>Финиш</legend><div className="walk-options"><label><input type="radio" name="mode" checked={draft.mode === "loop"} onChange={() => edit({ mode: "loop" })} /> Вернуться к началу</label><label><input type="radio" name="mode" checked={draft.mode === "open"} onChange={() => edit({ mode: "open" })} /> Закончить у последнего дома</label></div></fieldset>
      <fieldset disabled={locked}><legend>Время ходьбы, без прослушивания</legend><div className="walk-options">{([30,60,90] as const).map(minutes => <label key={minutes}><input type="radio" name="minutes" checked={draft.minutes === minutes} onChange={() => edit({ minutes })} />{minutes} мин</label>)}</div></fieldset>
      <button className="walk-primary" disabled={locked || !draft.start || !!candidate || (selection === "manual" && !validStops(draft.start, draft.stops))} onClick={() => void plan()}>{selection === "auto" ? "Подобрать и построить маршрут" : "Построить маршрут по остановкам"}</button>
      {!draft.route ? <p className="walk-muted">После изменений нужно построить маршрут заново. Без проверенного вами маршрута подготовка не начнётся.</p> : null}
    </section>
    {busy ? <p role="status">{busy}</p> : null}{error ? <p className="walk-warning" role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    {draft.route ? <section aria-labelledby="walk-review"><h2 id="walk-review">Проверьте маршрут</h2><p className="walk-summary">{(draft.route.distanceM / 1000).toLocaleString("ru", { maximumFractionDigits: 1 })} км · {draft.route.walkingMinutes} мин пешком</p><p>{draft.mode === "loop" ? "Возвращаемся к началу." : `Финиш: ${draft.stops.at(-1)?.address}.`} Прослушивание добавит время к прогулке.</p><p className="walk-warning">Маршрут рассчитан по карте, но не проверен на местности. Проходы могут быть закрыты. Соблюдайте знаки, проверяйте переходы и не заходите на частную территорию.</p><p className="walk-muted">{draft.route.attribution}</p><label className="walk-check"><input type="checkbox" checked={reviewed} disabled={locked || !!candidate} onChange={e => setReviewed(e.target.checked)} /> Я проверил начало, остановки, финиш и линию на карте</label><p>Истории для начала и каждой остановки, без повторения при возвращении. Готовим по одной: обычно 5–10 минут на дом. Общий лимит сервиса: 2 активные задачи и 6 новых в сутки, включая отдельные истории.</p><button className="walk-primary" disabled={locked || !reviewed || !!candidate || !nextPlace || !!activeJob || !!draft.submitting || !!storageError || draft.jobs.length >= 100} onClick={() => void prepareNext()}>{nextPlace ? "Подтвердить и подготовить следующую историю" : "Для всех точек уже есть истории"}</button>{nextPlace ? <p>Следующая: {nextPlace.address}</p> : null}</section> : null}
    {draft.submitting ? <section className="walk-warning"><h2>Проверьте последнюю отправку</h2><p>Адрес: {draft.submitting.address}. Ответ мог потеряться, даже если сервер принял задачу. Новая отправка заблокирована, чтобы не создать дубликат.</p><label className="walk-field">ID созданной истории<input value={recoveryId} onChange={e => setRecoveryId(e.target.value.trim())} placeholder="ID из ссылки /create?job=…" /></label><button disabled={locked || !isJobId(recoveryId)} onClick={() => void recoverJob()}>Привязать найденную историю</button><button disabled={locked || !!storageError} onClick={() => { if (window.confirm("Сбрасывайте только если убедились, что сервер не создал задачу. Иначе повторная отправка создаст дубликат и потратит лимит. Продолжить?")) persist({ ...current.current, submitting: null }); }}>Задача точно не создана: разрешить новую отправку</button></section> : null}
    {draft.jobs.length ? <section aria-labelledby="walk-stories"><h2 id="walk-stories">Истории этой прогулки</h2><p>Ссылки сохраняются и после изменения маршрута. Ошибки и истории без подтверждений не перезапускаем автоматически.</p><ol className="walk-stops">{draft.jobs.map(j => <li key={j.id}><strong>{j.place.address}</strong><p role="status">{stageLabels[j.stage]}{!places.some(p => storyAddressKey(p.address) === storyAddressKey(j.place.address)) ? " · вне текущего маршрута" : ""}</p><Link href={`/create?job=${j.id}`} target="_blank" rel="noopener" prefetch={false}>Открыть историю в новой вкладке</Link><p className="walk-muted">Прогулка останется в этой вкладке. После прослушивания вернитесь сюда.</p><button disabled={!!pollId || locked || !!storageError} onClick={() => { setError(""); setPollId(j.id); }}>Обновить статус</button></li>)}</ol>{pollId ? <button onClick={() => setPollId(null)}>Приостановить проверку статуса</button> : null}</section> : null}
    <footer><Link href="/" prefetch={false}>На карту историй</Link><Link href="/walk?resume=1" prefetch={false}>Моя прогулка</Link><button onClick={download}>Скачать черновик</button></footer>
  </main>;
}
