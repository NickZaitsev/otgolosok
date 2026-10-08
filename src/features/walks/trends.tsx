"use client";

import { AppHeader } from "../navigation/app-header";
import { useI18n } from "@/lib/i18n/provider";
import { TopWalks } from "./top-walks";
import "./history.css";

export function Trends() {
  const { t } = useI18n();
  return <main className="ui-page history-page"><AppHeader />
    <header className="history-heading"><div><p className="ui-eyebrow">{t("Выбор слушателей")}</p><h1>{t("Тренды")}</h1><p className="ui-muted">{t("Популярные прогулки с оценками слушателей.")} {t("Для старта и финиша указано ближайшее метро.")}</p></div></header>
    <TopWalks filterable />
  </main>;
}
