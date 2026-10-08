"use client";
import Link from "next/link";
import { BrandMark } from "../brand/brand-mark";
import { useI18n } from "@/lib/i18n/provider";
export function AppHeader() {
  const { t, path } = useI18n();
  return <header className="app-header"><Link href={path("/")} aria-label={t("Отголосок, на главную")}><BrandMark /></Link><span>{t("Город говорит рядом")}</span></header>;
}
