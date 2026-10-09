"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { searchMetroOptions, type MetroLine, type MetroOption } from "./top-model";
import styles from "./metro-select.module.css";

/** Filled dots for a station's lines; a zone draws its line as a ring. */
function LineDots({ lines, zone = false }: { lines: MetroLine[]; zone?: boolean }) {
  return <span className={styles.dots} aria-hidden="true">{lines.length
    ? lines.map(line => <span key={line.id} className={`${styles.dot} ${zone ? styles.zone : ""}`} title={line.name} style={zone ? { borderColor: line.color } : { backgroundColor: line.color }} />)
    : <span className={`${styles.dot} ${styles.dotUnknown}`} />}</span>;
}

/**
 * Station picker for the metro filters: a button opens a search field over the station list (ARIA combobox with a listbox popup).
 * The first option resets the filter; search ignores case and ё and also matches line names.
 */
export function MetroSelect({ label, value, options, onChange }: { label: string; value: string; options: MetroOption[]; onChange: (name: string) => void }) {
  const { t } = useI18n();
  const id = useId(), labelId = `${id}-label`, listId = `${id}-list`;
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), search = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const any: MetroOption = { name: "", lines: [] };
  const matches = useMemo(() => searchMetroOptions(options, query), [options, query]);
  // «Any station» stays first while the field is empty and drops out of a search.
  const items = query.trim() ? matches : [any, ...matches];
  const selected: MetroOption | null = options.find(option => option.name === value) ?? (value ? { name: value, lines: [] } : null);

  const show = (initial = "") => {
    const start = initial ? searchMetroOptions(options, initial) : [any, ...options];
    setQuery(initial); setActive(Math.max(0, start.findIndex(option => option.name === value))); setOpen(true);
  };
  const close = (focusTrigger: boolean) => { setOpen(false); setQuery(""); if (focusTrigger) trigger.current?.focus(); };
  const choose = (option: MetroOption) => { close(true); if (option.name !== value) onChange(option.name); };

  useEffect(() => { if (open) search.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setQuery(""); } };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    const option = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (open && option && typeof option.scrollIntoView === "function") option.scrollIntoView({ block: "nearest" });
  }, [open, active, query]);

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
    // Typing on the closed picker starts the search with that letter.
    else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); show(event.key); }
  };
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = items.length - 1;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(last, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === "PageDown") { event.preventDefault(); setActive(index => Math.min(last, index + 8)); }
    else if (event.key === "PageUp") { event.preventDefault(); setActive(index => Math.max(0, index - 8)); }
    else if (event.key === "Enter") { event.preventDefault(); const option = items[active]; if (option) choose(option); }
    else if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "Tab") close(false);
  };

  return <div className={styles.field} ref={root}>
    <span id={labelId} className={styles.label}>{label}</span>
    <button ref={trigger} type="button" className={styles.trigger} aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${labelId} ${id}-value`}
      onClick={() => open ? close(false) : show()} onKeyDown={onTriggerKey}>
      {selected ? <LineDots lines={selected.lines} zone={Boolean(selected.label)} /> : null}
      <span id={`${id}-value`} className={selected ? styles.value : styles.placeholder}>{selected ? selected.label ?? selected.name : t("Любая станция")}</span>
    </button>
    {open ? <div className={styles.popup}>
      <input ref={search} className={styles.search} type="search" role="combobox" value={query} placeholder={t("Найти станцию или линию")}
        aria-label={t("Поиск: {label}", { label })} aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={items[active] ? `${id}-option-${active}` : undefined} autoComplete="off" spellCheck={false}
        onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={onSearchKey} />
      {items.length ? <ul ref={list} id={listId} role="listbox" aria-labelledby={labelId} className={styles.list}>
        {items.map((option, index) => <li key={option.name || "any"} id={`${id}-option-${index}`} data-index={index} role="option" aria-selected={option.name === value}
          className={`${styles.option} ${index === active ? styles.active : ""}`}
          onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(option)}>
          {option.name ? <><LineDots lines={option.lines} zone={Boolean(option.label)} /><span className={styles.name}>{option.label ?? option.name}</span>
            {option.hint || option.lines.length ? <span className={styles.lineNames}>{option.hint ?? option.lines.map(line => line.name).join(", ")}</span> : null}</>
            : <span className={styles.name}>{t("Любая станция")}</span>}
        </li>)}
      </ul> : <p className={styles.empty} role="status">{t("Станция не найдена")}</p>}
    </div> : null}
  </div>;
}
