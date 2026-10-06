"use client";

import Link from "next/link";
import { formatNearbyWalkMeta, isOwnNearbyWalk, nearbyWalkHref, type NearbyWalk } from "../walks/nearby-model";
import styles from "./nearby-walks.module.css";

/**
 * Ready walks passing near the chosen start, or near the user before a start is chosen: the user
 * can go on one instead of building a new walk. Collapsed by default so the creation sheet stays
 * low; the summary shows how many there are.
 */
export function NearbyWalks({ walks, origin }: { walks: NearbyWalk[]; origin: "start" | "you" }) {
  return <details className={styles.section} data-creation="nearby">
    <summary className={styles.summary}>{origin === "you" ? "Близко к вам" : "Прогулки рядом"} · {walks.length}</summary>
    <ol className={styles.list}>
      {walks.map(walk => <li key={`${walk.kind}:${walk.id}`}>
        <Link className={styles.card} href={nearbyWalkHref(walk)}>
          <span className={styles.titleRow}>
            <strong className={styles.title}>{walk.title}</strong>
            {isOwnNearbyWalk(walk) && <span className={styles.badge}>Ваша</span>}
          </span>
          <span className={styles.meta}>{formatNearbyWalkMeta(walk)}</span>
        </Link>
      </li>)}
    </ol>
  </details>;
}
