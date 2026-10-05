"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "../ui/cx";
import { ExploreIcon } from "./icons";
import { placeShareUrl } from "./place-link";
import { browserShareEnvironment, sharePlace, type ShareOutcome } from "./share-place";
import a from "./around.module.css";

/**
 * «Поделиться» for a catalog place: the shared link (`/place/<type>/<number>`) carries a preview with the title and
 * the photo. Key it by the place so the result of sharing never outlives its place.
 */
export function SharePlaceButton({ placeId, title }: { placeId: string; title: string }) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const busy = useRef(false);
  const [url, setUrl] = useState("");
  const copied = useRef<HTMLParagraphElement>(null), field = useRef<HTMLInputElement>(null);
  // The result appears under the button, where an expanded card pins its player: bring it into view. The field
  // takes focus, which selects the link for copying.
  useEffect(() => {
    if (outcome === "copied") copied.current?.scrollIntoView({ block: "nearest" });
    else if (outcome === "manual") field.current?.focus();
  }, [outcome]);
  async function share() {
    // The share sheet is open: a second tap must not stack another one.
    if (busy.current) return;
    busy.current = true;
    const link = placeShareUrl(placeId, location.origin);
    setUrl(link);
    setOutcome(null);
    try { setOutcome(await sharePlace({ title, url: link }, browserShareEnvironment())); }
    finally { busy.current = false; }
  }
  return <>
    <button type="button" className={cx(a.secondary, a.bodyAction)} onClick={() => void share()}>Поделиться <ExploreIcon name="share" /></button>
    {outcome === "copied" ? <p ref={copied} className={cx(a.text, a.bodyAction)} role="status">Ссылка скопирована.</p> : null}
    {outcome === "manual" ? <label className={cx("ui-field", a.bodyAction)}>Скопируйте ссылку
      <input ref={field} readOnly value={url} onFocus={event => event.currentTarget.select()} />
    </label> : null}
  </>;
}
