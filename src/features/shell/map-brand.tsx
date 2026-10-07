"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import { BrandMark } from "../brand/brand-mark";
import styles from "./map-brand.module.css";

/** The brand in the header island of every map screen, leading back to the start. */
export function MapBrand({ onClick }: { onClick?: () => void }) {
  const { t, path } = useI18n();
  return <Link href={path("/")} prefetch={false} className={styles.brand} aria-label={t("Отголосок, на главную")} onClick={onClick}><BrandMark className={styles.mark} /></Link>;
}
