"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import type { Coordinates } from "../tour/types";
import type { MapItem } from "../explore/explore-map";
import { useWalkDraft } from "./use-walk-draft";
import { creationReducer } from "./creation-state";
import { moveStop } from "./model";
import { ResearchPanel } from "./research-panel";
import "../ui/surfaces.css";
import "./walk-creation-panel.css";

export type CreationMap = { items: MapItem[]; geometry?: Coordinates[]; focus: Coordinates | null; picking: boolean; padding?: {top:number;right:number;bottom:number;left:number} };
export function WalkCreationPanel({ onClose, onMap, picked }: { onClose: () => void; onMap: (value: CreationMap) => void; picked: Coordinates | null }) {
  const w = useWalkDraft();
  const [state, dispatch] = useReducer(creationReducer, { step: "location", picking: false });
  const [chosenMode, setMode] = useState<"destination" | "time" | null>(null);
  const mode = chosenMode ?? w.initialMode;
  const [geoBusy, setGeoBusy] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const [padding, setPadding] = useState({top:100,right:24,bottom:110,left:24});
  const title = useRef<HTMLHeadingElement>(null);
  const busy = Boolean(w.busy) || geoBusy;
  useEffect(() => {
    const measure = () => {
      const rect = panel.current?.getBoundingClientRect(); if (!rect) return;
      const side = innerWidth >= 700 || innerHeight <= 560;
      const next = {top:100,right:24,bottom:side?110:Math.ceil(innerHeight-rect.top+16),left:side?Math.ceil(rect.right+24):24};
      setPadding(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    const observer = new ResizeObserver(measure);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const resolvePoint = useEffectEvent((point: Coordinates) => { void w.resolve(point); dispatch({ type: "return" }); });
  const close = useEffectEvent(onClose);
  useEffect(() => { title.current?.focus(); const escape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, []);
  useEffect(() => { if (picked) resolvePoint(picked); }, [picked]);
  useEffect(() => {
    const places = [w.draft.start, ...w.draft.stops, w.draft.destination].filter(p => p != null);
    onMap({ items: places.map((p, i) => ({ id: `creation-${i}`, title: p.address, location: p.location, number: i + 1 })), geometry: w.draft.route?.geometry, focus: w.focus, picking: state.picking, padding });
  }, [w.draft.start, w.draft.stops, w.draft.destination, w.draft.route, w.focus, state.picking, padding, onMap]);

  function locate() {
    if (!navigator.geolocation) { w.setError("Геолокация недоступна. Найдите адрес или выберите точку на карте."); return; }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(p => { setGeoBusy(false); void w.resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); }, () => { setGeoBusy(false); w.setError("Не удалось определить место. Выберите точку на карте или введите адрес."); }, { timeout: 12000, maximumAge: 30000, enableHighAccuracy: true });
  }
  function changeMode(next: "destination" | "time") {
    setMode(next); w.edit({ destination: null, mode: next === "time" ? "loop" : "open" });
    w.setTarget(next === "destination" && w.draft.start ? "destination" : "start");
  }
  async function build() { await w.plan(); if (w.current.current.route) dispatch({ type: "step", step: "preview" }); }
  const preview = Boolean(w.draft.route) && !state.picking;

  return <section ref={panel} className={`creation-panel${state.picking ? " is-picking" : preview ? " is-preview" : ""}`} aria-labelledby="creation-title">
    <div className="creation-handle" aria-hidden="true" />
    <header className="creation-heading"><div><p className="ui-eyebrow">В своём темпе</p><h1 id="creation-title" ref={title} tabIndex={-1}>{preview ? "Ваш маршрут" : "Куда пойдём?"}</h1></div><button className="creation-close" onClick={onClose} aria-label="Закрыть создание прогулки">×</button></header>
    <div className="creation-body">
      {!w.loaded ? <p role="status">Открываем черновик…</p> : w.resumeChoice ? <div className="creation-resume"><h2>Продолжим прогулку?</h2><p>У вас есть черновик «{w.draft.title}». Он останется в истории, если начать новую.</p><button className="ui-button" onClick={() => w.setResumeChoice(false)}>Продолжить</button><button className="ui-button secondary" onClick={() => { setMode(null); w.newDraft(); }}>Новая прогулка</button></div> : <>
        {!preview && !state.picking && <>
          <p className="creation-intro">Выберите начало. Мы найдём интересные места по пути.</p>
          <div className="creation-segments" aria-label="Способ построения"><button aria-pressed={mode === "destination"} onClick={() => changeMode("destination")} disabled={busy}>До места</button><button aria-pressed={mode === "time"} onClick={() => changeMode("time")} disabled={busy}>По времени</button></div>
          <div className="creation-endpoints">
            <button className={w.target === "start" ? "selected" : ""} onClick={() => { w.setTarget("start"); w.setCandidate(null); w.setQuery(""); }}><span className="creation-letter">А</span><span><small>Откуда</small><strong>{w.draft.start?.address ?? "Выберите начало прогулки"}</strong></span></button>
            {mode === "destination" && <button className={w.target === "destination" ? "selected" : ""} onClick={() => { w.setTarget("destination"); w.setCandidate(null); w.setQuery(""); }}><span className="creation-letter finish">Б</span><span><small>Куда</small><strong>{w.draft.destination?.address ?? "Куда хотите прийти?"}</strong></span></button>}
          </div>
          <form className="creation-search" onSubmit={e => { e.preventDefault(); void w.resolve(w.query.trim()); }}><label className="ui-field">{w.target === "destination" ? "Адрес финиша" : w.target === "stop" ? "Адрес остановки" : "Адрес начала"}<input value={w.query} onChange={e => w.setQuery(e.target.value)} placeholder="Улица и номер дома в Москве" minLength={6} maxLength={180} required disabled={busy} /></label><button className="ui-button secondary" disabled={busy || w.query.trim().length < 6}>Найти</button></form>
          <div className="ui-row"><button className="creation-text" disabled={busy} onClick={() => dispatch({ type: "pick" })}>Выбрать на карте</button><button className="creation-text" disabled={busy} onClick={locate}>Моё местоположение</button></div>
          {w.candidate && <div className="creation-candidate"><p>{w.candidate.address}</p><button className="ui-button" onClick={() => { w.confirmPlace(); if (w.target === "start" && mode === "destination") w.setTarget("destination"); }}>Выбрать эту точку</button></div>}
          <fieldset className="creation-time" disabled={busy}><legend>Сколько готовы идти?</legend><div>{([30, 60, 90] as const).map(minutes => <button type="button" key={minutes} aria-pressed={w.draft.minutes === minutes} onClick={() => w.edit({ minutes })}>{minutes} мин</button>)}</div><p>Время пешком, без остановок на прослушивание</p></fieldset>
          {mode === "time" && <label className="creation-switch"><span>Вернуться к началу<small>Маршрут закончится там, где вы начали</small></span><input type="checkbox" checked={w.draft.mode === "loop"} onChange={e => w.edit({ mode: e.target.checked ? "loop" : "open" })} /></label>}
        </>}
        {state.picking && <div><p>Нажмите на карту в нужном месте.</p><button className="ui-button secondary" onClick={() => dispatch({ type: "return" })}>Вернуться к адресам</button></div>}
        {preview && <>
          <div className="creation-summary"><strong>{w.draft.route!.walkingMinutes} <small>мин пешком</small></strong><strong>{(w.draft.route!.distanceM / 1000).toFixed(1).replace(".", ",")} <small>км</small></strong></div>
          <p className="ui-muted">{w.draft.start?.address} → {w.draft.destination?.address ?? (w.draft.mode === "loop" ? "возвращение к началу" : "последняя остановка")}</p>
          <ol className="creation-stops">{w.draft.stops.map((stop, i) => <li key={`${stop.address}-${i}`}><span>{stop.address}</span><div><button disabled={busy || i === 0} aria-label={`Поднять остановку ${i + 1}`} onClick={() => w.edit({ stops: moveStop(w.draft.stops, i, -1) })}>↑</button><button disabled={busy} aria-label={`Удалить остановку ${i + 1}`} onClick={() => w.edit({ stops: w.draft.stops.filter((_, index) => index !== i) })}>×</button></div></li>)}</ol>
          {!w.draft.stops.length && <p className="ui-notice">Пешеходный маршрут построен. Исторических остановок по пути пока нет.</p>}
          <details className="creation-details"><summary>Изменить название и маршрут</summary><label className="ui-field">Название<input value={w.draft.title} maxLength={120} onChange={e => w.persist({ ...w.current.current, title: e.target.value })} /></label><button className="creation-text" onClick={() => w.edit({})}>Изменить точки</button><button className="creation-text" onClick={() => { w.setTarget("stop"); w.edit({}); }}>Добавить остановку</button><button className="creation-text" onClick={w.download}>Скачать черновик</button></details>
          {w.nextPlace && <label className="creation-consent"><input type="checkbox" checked={w.reviewed} onChange={e => w.setReviewed(e.target.checked)} />Подготовить историю выбранной остановки с помощью ИИ. Факты будут проверены по источникам.</label>}
          {w.nextPlace && <button className="ui-button secondary" disabled={busy || !w.reviewed || !!w.activeJob || !!w.draft.submitting || !!w.storageError} onClick={() => void w.prepareNext()}>Подготовить историю</button>}
          {w.draft.jobs.length > 0 && <div className="creation-jobs">{w.draft.jobs.map(job => <Link key={job.id} href={`/create?job=${job.id}`}>История: {job.place.address} →</Link>)}</div>}
          {w.openHref && <Link className="ui-button" href={w.openHref}>Открыть прогулку</Link>}
          <button className="creation-text" disabled={busy} onClick={() => void w.saveToAccount()}>{w.serverWalk ? "Обновить в аккаунте" : "Сохранить в аккаунте"}</button>
        </>}
        <ResearchPanel draft={w.draft} current={w.current} persist={w.persist} offered={w.researchOffered} disabled={busy || !!w.storageError} chooseStartDisabled={busy} action={w.action} setBusy={w.setBusy} onApply={() => dispatch({ type: "step", step: "preview" })} onChooseStart={() => { w.setTarget("start"); w.edit({}); }} />
        {w.draft.submitting && <div className="ui-notice"><p>Результат отправки неизвестен. Введите ID истории из раздела запросов профиля.</p><label className="ui-field">ID истории<input value={w.recoveryId} onChange={e => w.setRecoveryId(e.target.value)} /></label><button className="ui-button secondary" onClick={() => void w.recoverJob()}>Восстановить</button></div>}
      </>}
      {w.storageError && <div role="alert" className="ui-notice">{w.storageError}<button className="creation-text" onClick={w.download}>Скачать черновик</button></div>}
      {w.error && <p className="ui-notice" role="alert">{w.error}</p>}
      {w.message && <p className="ui-notice" role="status">{w.message}</p>}
      {busy && <p role="status" className="ui-muted">{w.busy || "Определяем местоположение…"}</p>}
    </div>
    {w.loaded && !w.resumeChoice && !preview && !state.picking && <footer className="creation-footer"><button className="ui-button" disabled={busy || !w.draft.start || (mode === "destination" && !w.draft.destination) || !!w.candidate || !!w.storageError} onClick={() => void build()}>Построить прогулку <span aria-hidden="true">→</span></button></footer>}
  </section>;
}
