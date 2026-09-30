import styles from "./map-attribution.module.css";

/** The data credit the basemap owes (VersaTiles serves OpenStreetMap data, see map-style.ts). */
export function MapAttribution() {
  return <p className={styles.attribution} data-region="attribution">
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
  </p>;
}
