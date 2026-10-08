"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../ui/cx";
import styles from "./map-controls.module.css";

/** A round map button with the shared island look; never smaller than a finger. */
export function MapControlButton({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx(styles.button, className)} {...props} />;
}

/** Screen buttons, e.g. «Моё местоположение». */
export function MapControls({ children }: { children: ReactNode }) {
  return <div className={styles.controls} data-region="controls">
    {children}
  </div>;
}
