import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FoodPlace } from "./types";
import type { FoodManifest } from "./food-cells";
import { foodGroup, foodIcon, formatFoodCategory } from "./food-kinds";
import { formatHolidayCaveat, formatHoursStatus } from "./opening-hours";
import { formatRouteDistance } from "./route-proximity";
import { createFoodHoursCache, foodPhone, foodWebsite, groupRouteFood, splitRouteFood, type RouteFoodPlace } from "./food-walk-model";
import styles from "./food-list.module.css";

export function FoodGlyph({ kind = "coffee" }: { kind?: RouteFoodPlace["kind"] }) {
  const icon = foodIcon(kind);
  return <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill={`var(${foodGroup(kind).colorToken})`} stroke="none" /><path d={icon.glyph} transform="translate(5.5 5.5) scale(.87)" fill="var(--on-dark)" stroke="none" /></svg>;
}
export function FoodAttribution({ manifest }: { manifest: FoodManifest }) {
  const date = new Date(manifest.sourceEditedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
  return <p className={styles.attribution}>Данные OpenStreetMap на {date}. Часы работы могут отличаться.<br />{manifest.attribution}</p>;
}
/** Adding venues to the walk: which ones are in it, which one is being added and the outcome to announce. */
export type FoodAdding = { isAdded: (place: FoodPlace) => boolean; onAdd: (place: RouteFoodPlace) => void; pending: string | null; status: string };

export function FoodList({ places, stops, active, fromM, selected, onSelect, onBack, manifest, hours, error, loading, onRetry, adding = null }: {
  places: RouteFoodPlace[]; stops: Array<{ alongM: number }>; active: boolean; fromM: number;
  selected: RouteFoodPlace | null; onSelect: (place: RouteFoodPlace) => void; onBack: () => void;
  hours: ReturnType<typeof createFoodHoursCache>; manifest: FoodManifest; error: boolean; loading: boolean; onRetry: () => void;
  /** Null where venues cannot join the walk. */
  adding?: FoodAdding | null;
}) {
  const minute = useFoodMinute();
  const statuses = useMemo(() => new Map(places.map(p => [p.id, hours(p.openingHours, new Date(minute * 60_000))])), [places, hours, minute]);
  const groups = useMemo(() => groupRouteFood(places, stops), [places, stops]);
  const { ahead, behind } = useMemo(() => splitRouteFood(places, fromM), [places, fromM]);
  // During the walk only the venues ahead can join it: the way to those behind is already walked.
  const list = (items: RouteFoodPlace[], addable = true) => <ul className={styles.list}>{items.map(place => <li key={place.id} className={styles.item}>
    <button type="button" className={styles.row} onClick={() => onSelect(place)}><FoodGlyph kind={place.kind} /><span><strong>{place.name}</strong><span>{formatHoursStatus(statuses.get(place.id)!)}</span><span>{formatRouteDistance(place.distanceM)}</span></span></button>
    {adding && addable ? <FoodAddButton place={place} adding={adding} /> : null}
  </li>)}</ul>;
  const status = adding?.status ? <p role="status" className={styles.status}>{adding.status}</p> : null;
  if (selected) return <FoodCard place={selected} manifest={manifest} hours={hours} onBack={onBack}
    action={adding && (!active || selected.alongM >= fromM) ? <>{status}<FoodAddButton place={selected} adding={adding} wide /></> : status} />;
  return <section aria-label="Заведения вдоль маршрута" className={styles.content}><h2>Поесть рядом</h2>{status}{error ? <div role="status"><p>Не удалось загрузить заведения</p><button type="button" className={styles.link} onClick={onRetry}>Повторить</button></div> : loading ? <p role="status">Загружаем заведения…</p> : !places.length ? <p>В 150 м от маршрута заведений нет по данным OpenStreetMap</p> : null}{active ? <>{ahead.length ? <><h3>Впереди</h3>{list(ahead)}</> : null}{behind.length ? <details><summary>Позади · {behind.length}</summary>{list(behind, false)}</details> : null}</> : groups.map((group, i) => <div key={i}>{group.stop !== null ? <h3>У остановки {group.stop + 1}</h3> : null}{list(group.places)}</div>)}<FoodAttribution manifest={manifest} /></section>;
}

function useFoodMinute() {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { setMinute(Math.floor(Date.now() / 60_000)); timer = setTimeout(tick, 60_000 - Date.now() % 60_000); };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return minute;
}

function FoodAddButton({ place, adding, wide = false }: { place: RouteFoodPlace; adding: FoodAdding; wide?: boolean }) {
  if (adding.isAdded(place)) return <span className={wide ? styles.addedWide : styles.added}>В прогулке</span>;
  const busy = adding.pending === place.id;
  return <button type="button" className={wide ? styles.addWide : styles.add} aria-label={wide ? undefined : `Добавить «${place.name}» в прогулку`} aria-busy={busy}
    disabled={adding.pending !== null} onClick={() => adding.onAdd(place)}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    {wide ? busy ? "Прокладываем путь…" : "Добавить в прогулку" : null}
  </button>;
}

export function FoodCard({ place, manifest, hours, onBack, distanceLabel, heading = true, action = null }: {
  place: FoodPlace; manifest: FoodManifest; hours: ReturnType<typeof createFoodHoursCache>;
  onBack?: () => void; distanceLabel?: string; heading?: boolean;
  /** What the walker can do with the venue, under its details. */
  action?: ReactNode;
}) {
  const minute = useFoodMinute();
  const status = hours(place.openingHours, new Date(minute * 60_000));
  const website = foodWebsite(place.website), phone = foodPhone(place.phone);
  return <section className={styles.card} aria-label="Заведение">{onBack ? <button type="button" className={styles.link} onClick={onBack}>Назад к списку</button> : null}{heading ? <h2>{place.name}</h2> : null}<p>{formatFoodCategory(place.kind, place.cuisine)}</p>{distanceLabel ? <p>{distanceLabel}</p> : null}<p>{formatHoursStatus(status)}</p>{formatHolidayCaveat(status) ? <p>{formatHolidayCaveat(status)}</p> : null}{place.openingHours ? <details><summary>Часы работы по данным OpenStreetMap</summary><p>{place.openingHours}</p></details> : null}{place.address ? <p>{place.address}</p> : null}{action}<div className={styles.links}>{website ? <a href={website} target="_blank" rel="noopener noreferrer">Сайт</a> : null}{phone ? <a href={phone}>Позвонить</a> : null}</div><FoodAttribution manifest={manifest} /></section>;
}
