"use client";

import { useEffect, useId, useState } from "react";
import { readFetch } from "../auth/read-fetch";
import { isPlace, type Place } from "./model";

export function AddressInput({ label, onSelect, onResolve, disabled = false }: { disabled?: boolean; label: string; onSelect: (place: Place) => void; onResolve: (query: string) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; places: Place[]; error?: string } | null>(null);
  const [active, setActive] = useState(-1);
  const normalized = query.trim();
  const current = result?.query === normalized ? result : null;
  const places = current?.places ?? [];
  useEffect(() => {
    if (normalized.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await readFetch(`/api/content/places?${new URLSearchParams({ q: normalized, limit: "6", status: "all" })}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Подсказки недоступны. Нажмите Enter для поиска адреса.");
        const data = await response.json();
        if (!Array.isArray(data.places)) throw new Error("Не удалось загрузить подсказки.");
        const unique = new Map<string, Place>();
        for (const place of data.places) if (isPlace(place)) unique.set(place.address, { address: place.address, location: place.location });
        if (!controller.signal.aborted) setResult({ query: normalized, places: [...unique.values()] });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ query: normalized, places: [], error: error instanceof Error ? error.message : "Подсказки недоступны." });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [normalized]);
  return <div className="creation-address-editor">
    <label className="creation-address-label"><span>{label}</span><input disabled={disabled} autoFocus role="combobox" aria-autocomplete="list" aria-expanded={places.length > 0} aria-controls={`${id}-list`} aria-activedescendant={active >= 0 && places[active] ? `${id}-${active}` : undefined} value={query} maxLength={180} placeholder="Улица и номер дома" autoComplete="off" onChange={event => { setQuery(event.target.value); setActive(-1); }} onKeyDown={event => {
      if (event.key === "ArrowDown" && places.length) { event.preventDefault(); setActive(index => (index + 1) % places.length); }
      if (event.key === "ArrowUp" && places.length) { event.preventDefault(); setActive(index => (index <= 0 ? places.length : index) - 1); }
      if (event.key === "Enter") { event.preventDefault(); if (places[active]) onSelect(places[active]); else if (normalized.length >= 3) onResolve(normalized); }
    }} /></label>
    <ul id={`${id}-list`} role="listbox" aria-label="Подсказки адресов" className="creation-suggestions">{places.map((place, index) => <li key={place.address} id={`${id}-${index}`} role="option" aria-selected={active === index} onMouseDown={event => event.preventDefault()} onClick={() => { if (!disabled) onSelect(place); }}>{place.address}</li>)}</ul>
    {normalized.length >= 3 && !places.length && <p className="creation-address-hint" role="status">{current?.error ?? (current ? "Нет подсказок. Enter — найти адрес." : "Ищем адреса…")}</p>}
  </div>;
}
