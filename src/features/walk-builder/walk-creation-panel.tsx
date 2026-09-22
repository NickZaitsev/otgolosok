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
  const [picker, setPicker] = useState<"choices" | "address" | "time" | null>(null);
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
  const resolvePoint = useEffectEvent(async (point: Coordinates) => { await w.resolve(point); setPicker("address"); dispatch({ type: "return" }); });
  const close = useEffectEvent(() => { if (picker) { setPicker(null); panel.current?.querySelector<HTMLButtonElement>(`[data-endpoint="${w.target}"]`)?.focus(); } else if (state.picking) dispatch({ type: "return" }); else onClose(); });
  useEffect(() => { title.current?.focus(); const escape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, []);
  // Synchronize a point selected by the external Leaflet map with the address picker.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (picked) void resolvePoint(picked); }, [picked]);
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
    w.setTarget("destination");
  }
  async function build() { await w.plan(); if (w.current.current.route) dispatch({ type: "step", step: "preview" }); }
  const preview = Boolean(w.draft.route) && !state.picking;

  const addressPicker = picker && <div id="creation-picker" className="creation-picker">
            {picker === "choices" && <div className="creation-options">
              <button onClick={() => { if (w.target === "destination") changeMode("destination"); setPicker("address"); }}>Ввести адрес</button>
              <button onClick={() => { if (w.target === "destination") changeMode("destination"); setPicker(null); dispatch({ type: "pick" }); }}>Выбрать на карте</button>
              {w.target === "destination" ? <button onClick={() => { if (mode !== "time") changeMode("time"); setPicker("time"); }}>По времени</button> : <button onClick={() => { setPicker("address"); locate(); }}>Моё местоположение</button>}
            </div>}
            {picker === "address" && <form className="creation-search" onSubmit={e => { e.preventDefault(); void w.resolve(w.query.trim()); }}><label className="ui-field">{w.target === "destination" ? "Адрес финиша" : w.target === "stop" ? "Адрес остановки" : "Адрес начала"}<input autoFocus value={w.query} onChange={e => w.setQuery(e.target.value)} placeholder="Улица и номер дома" minLength={6} maxLength={180} required disabled={busy} /></label><button className="ui-button secondary" disabled={busy || w.query.trim().length < 6}>Найти</button></form>}
            {w.candidate && <div className="creation-candidate"><p>{w.candidate.address}</p><button className="ui-button" onClick={() => { w.confirmPlace(); setPicker(null); }}>Выбрать эту точку</button></div>}
            {picker === "time" && <><fieldset className="creation-time" disabled={busy}><legend>Время пешком</legend><div>{([30, 60, 90] as const).map(minutes => <button type="button" key={minutes} aria-pressed={w.draft.minutes === minutes} onClick={() => w.edit({ minutes })}>{minutes} мин</button>)}</div></fieldset><label className="creation-switch"><span>Вернуться к началу</span><input type="checkbox" checked={w.draft.mode === "loop"} onChange={e => w.edit({ mode: e.target.checked ? "loop" : "open" })} /></label><button className="creation-text" onClick={() => setPicker(null)}>Готово</button></>}
          </div>;

  return <section ref={panel} className={`creation-panel${state.picking ? " is-picking" : preview ? " is-preview" : ""}`} aria-labelledby="creation-title">
    <div className="creation-handle" aria-hidden="true" />
    <header className={`creation-heading${preview ? "" : " is-compact"}`}><div><h1 id="creation-title" ref={title} tabIndex={-1}>{preview ? "Ваш маршрут" : "Прогулка"}</h1></div><button className="creation-close" onClick={onClose} aria-label="Закрыть создание прогулки">×</button></header>
    <div className="creation-body">
      {!w.loaded ? <p role="status">Открываем черновик…</p> : <>
        {!preview && !state.picking && <>
          <div className="creation-endpoints">
            {(["start", "destination"] as const).map(target => <div className="creation-endpoint" key={target}><button data-endpoint={target} aria-label={target === "start" ? "Откуда" : "Куда"} aria-expanded={w.target === target && picker !== null} aria-controls="creation-picker" disabled={busy} onClick={() => { w.setTarget(target); w.setCandidate(null); w.setQuery(""); setPicker(w.target === target && picker ? null : "choices"); }}><span className={`creation-letter${target === "destination" ? " finish" : ""}`}>{target === "start" ? "А" : "Б"}</span><span><small>{target === "start" ? "Откуда" : "Куда"}</small><strong>{target === "start" ? w.draft.start?.address ?? "Выберите начало" : mode === "time" ? `${w.draft.minutes} мин пешком${w.draft.mode === "loop" ? " · с возвращением" : ""}` : w.draft.destination?.address ?? "Выберите место или время"}</strong></span><svg className="creation-chevron" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>{w.target === target && addressPicker}</div>)}
          </div>
          {w.target === "stop" && addressPicker}


        </>}
        {state.picking && <div><p>Нажмите на карту в нужном месте.</p><button className="ui-button secondary" onClick={() => dispatch({ type: "return" })}>Вернуться к адресам</button></div>}
        {preview && <>
          <div className="creation-summary"><strong>{w.draft.route!.walkingMinutes} <small>мин пешком</small></strong><strong>{(w.draft.route!.distanceM / 1000).toFixed(1).replace(".", ",")} <small>км</small></strong></div>
          <p className="ui-muted">{w.draft.start?.address} → {w.draft.destination?.address ?? (w.draft.mode === "loop" ? "возвращение к началу" : "последняя остановка")}</p>
          <ol className="creation-stops">{w.draft.stops.map((stop, i) => <li key={`${stop.address}-${i}`}><span>{stop.address}</span><div><button disabled={busy || i === 0} aria-label={`Поднять остановку ${i + 1}`} onClick={() => w.edit({ stops: moveStop(w.draft.stops, i, -1) })}>↑</button><button disabled={busy} aria-label={`Удалить остановку ${i + 1}`} onClick={() => w.edit({ stops: w.draft.stops.filter((_, index) => index !== i) })}>×</button></div></li>)}</ol>
          {!w.draft.stops.length && <p className="ui-notice">Пешеходный маршрут построен. Исторических остановок по пути пока нет.</p>}
          <details className="creation-details"><summary>Изменить название и маршрут</summary><label className="ui-field">Название<input value={w.draft.title} maxLength={120} onChange={e => w.persist({ ...w.current.current, title: e.target.value })} /></label><button className="creation-text" onClick={() => w.edit({})}>Изменить точки</button><button className="creation-text" onClick={() => { w.setTarget("stop"); setPicker("address"); w.edit({}); }}>Добавить остановку</button><button className="creation-text" onClick={w.download}>Скачать черновик</button></details>
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
    {w.loaded && !preview && !state.picking && w.draft.start && (mode === "time" || w.draft.destination) && <footer className="creation-footer"><button className="ui-button" disabled={busy || !w.draft.start || (mode === "destination" && !w.draft.destination) || !!w.candidate || !!w.storageError} onClick={() => void build()}>Построить прогулку</button></footer>}
  </section>;
}
