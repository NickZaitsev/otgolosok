import Link from "next/link";
import { BrandMark } from "../brand/brand-mark";
import styles from "./around-header.module.css";

/** Header island of the home map: the brand, leading back to the start. */
export function AroundHeader() {
  return <Link href="/" prefetch={false} className={styles.brand}><BrandMark className={styles.mark} /></Link>;
}
