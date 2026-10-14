"use client";

import { useI18n } from "@/lib/i18n/provider";
import { ExploreIcon } from "../explore/icons";
import { Sheet } from "../shell/sheet";
import { yandexNavigationUrl } from "../travel/navigation";
import type { ParkingPlace } from "./types";
import styles from "./parking-sheet.module.css";

export function ParkingSheet({ place, attribution, onClose }: { place: ParkingPlace; attribution?: string; onClose: () => void }) {
  const { t } = useI18n();
  const navigation = yandexNavigationUrl(place.entrance, "driving");
  return <Sheet name="parking" state="overview" labelledBy="parking-title"
    header={<div className={styles.heading}><h1 id="parking-title">{place.name}</h1><button type="button" onClick={onClose} aria-label={t("Закрыть парковку")}><ExploreIcon name="close" /></button></div>}
    footer={navigation ? <a className="ui-button" href={navigation} target="_blank" rel="noopener noreferrer">{t("Доехать до парковки")}</a> : null}>
    <p>{t(place.access === "public" ? "Общественная парковка" : "Доступ на парковку не проверен. Перед поездкой убедитесь, что она открыта для всех.")}</p>
    <p>{t(place.fee === true ? "Платная парковка" : place.fee === false ? "Бесплатная парковка" : "Стоимость парковки неизвестна")}</p>
    {place.openingHours ? <p>{t("Часы работы")}: {place.openingHours}</p> : null}
    <p className="ui-muted">{t("Перед поездкой проверьте знаки и ограничения на месте.")}</p>
    {attribution ? <p className="ui-muted"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">{attribution}</a></p> : null}
  </Sheet>;
}
