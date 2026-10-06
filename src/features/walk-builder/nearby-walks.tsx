"use client";

import Link from "next/link";
import { useId } from "react";
import { formatRatingSummary } from "../reviews/model";
import { formatTopWalkMeta } from "../walks/top-model";
import { formatStartDistance, isOwnNearbyWalk, nearbyWalkHref, type NearbyWalk } from "../walks/nearby-model";
import styles from "./nearby-walks.module.css";

/** Ready walks starting near the chosen start: the user can go on one instead of building a new walk. */
export function NearbyWalks({ walks }: { walks: NearbyWalk[] }) {
  const heading = useId();
  return <section className={styles.section} aria-labelledby={heading} data-creation="nearby">
    <h2 id={heading} className={styles.heading}>Прогулки рядом</h2>
    <ol className={styles.list}>
      {walks.map(walk => <li key={`${walk.kind}:${walk.id}`}>
        <Link className={styles.card} href={nearbyWalkHref(walk)}>
          <span className={styles.titleRow}>
            <strong className={styles.title}>{walk.title}</strong>
            {isOwnNearbyWalk(walk) && <span className={styles.badge}>Ваша</span>}
          </span>
          <span className={styles.rating}>{formatRatingSummary(walk.rating) || "Пока без оценок"}</span>
          <span className={styles.meta}>{formatTopWalkMeta(walk)} · {formatStartDistance(walk.startDistanceM)}</span>
        </Link>
      </li>)}
    </ol>
  </section>;
}
