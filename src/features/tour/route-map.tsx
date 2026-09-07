import Image from "next/image";
import type { Route } from "./types";

export function RouteMap({ route }: { route: Route }) {
  return <figure className="route-visual" aria-labelledby="route-map-title">
    <div className="route-map-heading">
      <h2 id="route-map-title">Места прогулки</h2>
      <p>Кожевники · около 650 м</p>
    </div>
    <Image
      className="route-map-image"
      src="/data/maps/paveletskaya.svg"
      width={400} height={400} unoptimized
      alt="Карта пешеходного пути от 2-го Кожевнического переулка, 12с10 до Дербеневской набережной, 7с22. Четыре части прогулки отмечены по порядку. Москва-река восточнее, переходить её не нужно. Север сверху."
    />
    <figcaption className="route-map-caption">
      <span className="route-map-number" aria-hidden="true">1–4</span>
      <div>
        <p>{route.walk?.start.address}</p>
        <a href="#walk-plan">Четыре части одной прогулки</a>
        <p>Финиш: {route.walk?.finish.address}</p>
        <p>Проходы во дворах ещё не проверены на месте.</p>
      </div>
    </figcaption>
    <div className="route-map-links">
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
      <a href="https://www.openstreetmap.org/#map=18/55.7240/37.6500" target="_blank" rel="noreferrer">Открыть карту ↗</a>
    </div>
  </figure>;
}
