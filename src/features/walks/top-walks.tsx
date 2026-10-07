"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { toUserMessage } from "@/lib/errors/user-message";
import { formatRatingSummary } from "../reviews/model";
import { loadJson } from "./walk-loader";
import { formatTopWalkMeta, topWalkHref, validateTopWalks, type TopWalk } from "./top-model";
import styles from "./top-walks.module.css";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; walks: TopWalk[] };

/** The public ranking of walks. Mounted on first open of the tab, so it loads lazily. */
export function TopWalks() {
  const { locale, path, t } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadJson("/api/top-walks", controller.signal, validateTopWalks)
      .then(walks => setState({ status: "ready", walks }))
      .catch(caught => { if (!controller.signal.aborted) setState({ status: "error", message: toUserMessage(caught, "Не удалось загрузить топ прогулок.", locale) }); });
    return () => controller.abort();
  }, [attempt, locale]);

  if (state.status === "loading") return <p role="status" className="ui-muted">{t("Загружаем топ прогулок…")}</p>;
  if (state.status === "error") return <p role="alert" className="ui-notice">{state.message}{" "}
    <button type="button" className={styles.retry} onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}>{t("Повторить")}</button></p>;
  if (!state.walks.length) return <p className={styles.empty}>{t("В топе пока пусто. Откройте свою прогулку всем — после проверки она появится здесь.")}</p>;
  return <ol className={styles.list}>
    {state.walks.map((walk, index) => <li key={`${walk.kind}:${walk.id}`} className={styles.item}>
      <span className={styles.rank}>{index + 1}</span>
      <div className={styles.body}>
        <Link className={styles.title} href={path(topWalkHref(walk))}>{walk.title}</Link>
        <p className={styles.rating}>{formatRatingSummary(walk.rating, locale) || t("Пока без оценок")}</p>
        <p className={styles.meta}>{formatTopWalkMeta(walk, locale)}</p>
      </div>
    </li>)}
  </ol>;
}
