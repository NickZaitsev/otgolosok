"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import type * as Leaflet from "leaflet";
import { readCurrentCity, viewSuitsCity } from "../city/current-city";
import { foodMarkerSvg } from "../food/food-marker";
import type { FoodKind } from "../food/types";
import type { Coordinates } from "../tour/types";
import { NO_INSETS, type MapInsets } from "../shell/map-insets";
import type { MapStatus } from "../shell/map-status-notice";
import { cx } from "../ui/cx";
import { catalogArea, type MapViewport } from "./catalog-bounds";
import { createMapClusters, loadMapLibrary, type MapClusters } from "./map-clusters";
import { markerLook, type MarkerKind, type MarkerLook } from "./map-marker-look";
import { createMapView, type MapFocus, type MapView } from "./map-view";
import { chevronMarks, ROUTE_COVERED_DASH, routeRuns } from "./route-style";
import { WALK_OVERVIEW_COLORS, walksAtPoint } from "./walk-overview";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./explore-map.module.css";
import { useI18n } from "@/lib/i18n/provider";

/** Raster basemap for browsers without WebGL, which the vector basemap requires. */
export const FALLBACK_TILE_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
/**
 * The whole city fits at z10. Further out the basemap tiles carry greenery only as ESA WorldCover landcover,
 * which the style leaves out (it needs its own credit), so the map would turn grey; a city walk never needs that view.
 * Leaflet zooms are one above MapLibre's (512 px tiles): z10 here draws the style at z9.
 */
export const MAP_MIN_ZOOM = 10;
/**
 * Fractional zoom for the wheel and pinch: with Leaflet's default snap of 1 every touchpad tick,
 * however small, jumped a whole level after the wheel debounce. A mouse notch still moves about
 * one level (wheelPxPerZoomLevel compensates for the finer snap).
 */
export const MAP_ZOOM_OPTIONS = { zoomSnap: 0.25, zoomDelta: 1, wheelPxPerZoomLevel: 40 } as const;

function supportsWebGL() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  // jsdom and some locked-down browsers return undefined rather than null.
  return Boolean(gl);
}

type VectorModule = typeof import("@maplibre/maplibre-gl-leaflet");
type BasemapInternals = {
  _map: Leaflet.Map | null;
  _glMap: import("maplibre-gl").Map & { _actualCanvas: HTMLElement };
  _resizeContainer(): void;
  _zoomEnd(): void;
};

/**
 * maplibre-gl-leaflet 0.1.4 redraws after a resize in an animation frame without checking that
 * the layer is still on a map, so a resize right before unmount throws on the removed map.
 * Same redraw as upstream, skipped once the layer is gone.
 */
function safeBasemapLayer(
  L: typeof Leaflet,
  { MaplibreGL }: VectorModule,
): typeof Leaflet.MaplibreGL {
  return MaplibreGL.extend({
    _transitionEnd(this: BasemapInternals) {
      L.Util.requestAnimFrame(() => {
        const map = this._map;
        if (!map) return;
        const offset = map.latLngToContainerPoint(
          map.getBounds().getNorthWest(),
        );
        this._resizeContainer();
        L.DomUtil.setTransform(this._glMap._actualCanvas, offset, 1);
        this._glMap.once("moveend", () => this._zoomEnd());
        const center = map.getCenter();
        this._glMap.jumpTo({
          center: [center.lng, center.lat],
          zoom: map.getZoom() - 1,
        });
      });
    },
  });
}

export type MapItem = {
  id: string;
  title: string;
  location: Coordinates;
  number?: number;
  /** Food stays separate from story clusters. */
  foodKind?: FoodKind;
  /** A parking marker is a square P and never joins story clusters. */
  parking?: boolean;
  pending?: boolean;
  /** A background catalog point in a mode where stories are secondary (walk creation): a small plain dot. */
  compact?: boolean;
  /** Walk start or finish: a small hollow ring at the end of the line, not a story. */
  endpoint?: boolean;
  /** Only catalog points join clusters; chapters, own jobs and picked places stay individual pins. */
  clusterable?: boolean;
};
export type { MapFocus };
export type MapViewState = {
  current: { center: Coordinates; zoom: number; focus: MapFocus | null } | null;
};
/** A public walk drawn as a thin overview line; colorIndex is the 1-based --walk-overview-N token. */
export type WalkLine = { key: string; colorIndex: number; line: ReadonlyArray<readonly [number, number]> };
/** Points the map should show; keepUserView makes it a refinement that yields to a manual pan or zoom. */
export type MapFitTarget = { points: Coordinates[]; keepUserView: boolean };
export type ExploreMapProps = {
  items: MapItem[];
  selectedId?: string;
  focus: MapFocus | null;
  user: (Coordinates & { accuracyM: number }) | null;
  onSelect: (id: string) => void;
  onPoint: (point: Coordinates) => void;
  geometry?: Coordinates[];
  /** Mixed car routes keep their driving and walking legs visually distinct. */
  routeSegments?: ReadonlyArray<{ mode: "driving" | "walking"; geometry: Coordinates[] }>;
  /** False keeps the view on the focus: the route line is drawn without fitting the map to it. */
  fitGeometry?: boolean;
  /** Covered stretches of the route as [a, b] vertex ranges of geometry: drawn dashed. */
  tunnels?: ReadonlyArray<readonly [number, number]>;
  /** The leg to walk now as a vertex range: it stays bright with direction chevrons, the rest fades. */
  activeLeg?: readonly [number, number] | null;
  /** A new object fits the map to its points (a single point is focused). */
  fitTarget?: MapFitTarget | null;
  mapLabel?: string;
  viewState?: MapViewState;
  /** The part of the map no panel covers: focus and route are kept inside it. */
  insets?: MapInsets;
  onViewport?: (area: MapViewport) => void;
  onStatus?: (status: MapStatus) => void;
  /** Overview lines of public walks, under the route and the markers. */
  walkLines?: ReadonlyArray<WalkLine>;
  /** The overview walk drawn solid on top while the others fade. */
  selectedWalk?: string | null;
  /** A tap near overview lines selects them (nearest first) instead of picking a point on the map. */
  onWalks?: (keys: string[]) => void;
};

const MARKER_CLASS: Record<MarkerKind, string> = {
  place: styles.place,
  stop: styles.stop,
  pending: styles.pending,
  endpoint: styles.endpoint,
  background: styles.background,
  food: styles.food,
  parking: styles.parking,
};

const CHEVRON_SIZE = 12;
const WALK_LINE_DASH = "7 6";

/**
 * How far past each edge of the view the route is drawn, in view sizes. Leaflet clips
 * a line to its renderer and redraws only on moveend; with its default 0.1 a drag
 * across a desktop screen uncovered a stretch with no line until the map stopped.
 */
const ROUTE_RENDER_PADDING = 1;

/** Direction chevrons along the highlighted leg, in its pane, in the casing colour (see .chevron). */
function drawChevrons(rt: {
  L: typeof Leaflet;
  map: Leaflet.Map;
  chevrons: Leaflet.LayerGroup;
  activePath: Leaflet.LatLngExpression[] | null;
}) {
  rt.chevrons.clearLayers();
  if (!rt.activePath) return;
  const pixels = rt.activePath.map((point) => rt.map.latLngToLayerPoint(point));
  for (const mark of chevronMarks(pixels)) {
    const icon = rt.L.divIcon({
      className: styles.chevron,
      // A presentation attribute, not a style: the angle is a number we computed.
      html: `<svg viewBox="-6 -6 12 12" width="${CHEVRON_SIZE}" height="${CHEVRON_SIZE}" aria-hidden="true"><path transform="rotate(${mark.angleDeg.toFixed(1)})" d="M-2 -3.5 1.5 0 -2 3.5"/></svg>`,
      iconSize: [CHEVRON_SIZE, CHEVRON_SIZE],
      iconAnchor: [CHEVRON_SIZE / 2, CHEVRON_SIZE / 2],
    });
    rt.L.marker(rt.map.layerPointToLatLng([mark.x, mark.y]), { icon, pane: "routeActive", interactive: false, keyboard: false })
      .addTo(rt.chevrons)
      .getElement()
      ?.setAttribute("data-route-arrow", "");
  }
}

/** The map canvas only: controls, notices and attribution belong to the screen around it (MapShell). */
export function ExploreMap({
  items,
  selectedId,
  focus,
  user,
  onSelect,
  onPoint,
  geometry,
  routeSegments,
  fitGeometry = true,
  tunnels,
  activeLeg = null,
  fitTarget = null,
  mapLabel,
  viewState,
  insets = NO_INSETS,
  onViewport,
  onStatus,
  walkLines,
  selectedWalk = null,
  onWalks,
}: ExploreMapProps) {
  const { locale, t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<{
    L: typeof Leaflet;
    map: Leaflet.Map;
    view: MapView;
    colors: { route: string; walking: string; casing: string; user: string; walks: string[] };
    markers: Leaflet.LayerGroup;
    clusters: MapClusters;
    markerById: Map<
      string,
      {
        marker: Leaflet.Marker;
        look: string;
        dataMarker: MarkerLook["dataMarker"];
        clustered: boolean;
        location: Coordinates;
      }
    >;
    position: Leaflet.LayerGroup;
    route: Leaflet.LayerGroup;
    chevrons: Leaflet.LayerGroup;
    routePane: HTMLElement;
    renderers: Record<"route" | "routeActive" | "walks" | "walkSelected", Leaflet.Renderer>;
    walkPane: HTMLElement;
    walkLayer: Leaflet.LayerGroup;
    walkSelection: Leaflet.LayerGroup;
    /** Drawn overview lines by walk key, updated by key so a pan does not redraw them all. */
    walkPaths: Map<string, { path: Leaflet.Polyline; source: WalkLine["line"]; colorIndex: number }>;
    /** The highlighted leg, redrawn with its chevrons after every zoom. */
    activePath: Leaflet.LatLngExpression[] | null;
  } | null>(null);
  // Whether the current view target is the whole route (fitGeometry), not a leg or a focus.
  const routeFitted = useRef(false);
  const handlers = useRef({ onSelect, onPoint, onViewport, onWalks, selectedId });
  const appliedFocus = useRef<Coordinates | null>(null);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [mapError, setMapError] = useState(false);
  useEffect(() => {
    handlers.current = { onSelect, onPoint, onViewport, onWalks, selectedId };
  }, [onSelect, onPoint, onViewport, onWalks, selectedId]);
  useEffect(() => {
    onStatus?.({
      phase: mapError ? "failed" : ready ? "ready" : "loading",
      tilesOffline: tileError,
    });
  }, [onStatus, ready, mapError, tileError]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let viewportTimer: ReturnType<typeof setTimeout> | undefined;
    let saveView: (() => void) | undefined;
    void loadMapLibrary()
      .then(async (L) => {
        // The vector engine is large and useless without WebGL, so only those browsers download it.
        // If its chunk fails to load, the raster fallback still gives a working map.
        const vector = supportsWebGL()
          ? await Promise.all([
              import("@maplibre/maplibre-gl-leaflet"),
              import("./map-style"),
              import("./map-icons"),
            ]).catch(() => null)
          : null;
        if (disposed || !container.current) return;
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        // A map opens on the listener's city: without a saved view, or when the city was switched since
        // (the trends switch, another tab) and the saved view shows another city.
        const home = readCurrentCity();
        const saved = viewState?.current && viewSuitsCity(viewState.current.center, home) ? viewState.current : null;
        appliedFocus.current = saved?.focus ?? null;
        // Leaflet 1.9 leaves its zoom transition timer alive after remove().
        // Zoom immediately so switching tabs mid-zoom cannot touch a removed map.
        const map = L.map(container.current, {
          zoomControl: false,
          scrollWheelZoom: true,
          touchZoom: true,
          keyboard: true,
          attributionControl: false,
          zoomAnimation: false,
          fadeAnimation: !reduced,
          markerZoomAnimation: false,
          ...MAP_ZOOM_OPTIONS,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: 19,
        }).setView(
          saved
            ? [saved.center.lat, saved.center.lon]
            : [home.center.lat, home.center.lon],
          saved?.zoom ?? home.zoom,
        );
        if (viewState) {
          saveView = () => {
            const center = map.getCenter();
            viewState.current = {
              center: { lat: center.lat, lon: center.lng },
              zoom: map.getZoom(),
              focus: appliedFocus.current,
            };
          };
          map.on("moveend zoomend", saveView);
        }
        if (vector) {
          const [plugin, { mapStyle }, { drawMapIcon, MAP_ICON_PIXEL_RATIO }] =
            vector;
          // Leaflet keeps markers, route and controls; MapLibre only draws the basemap underneath.
          const Basemap = safeBasemapLayer(L, plugin);
          const basemap = new Basemap({
            style: mapStyle,
            attributionControl: false,
          })
            .addTo(map)
            .getMaplibreMap();
          basemap.on("error", () => setTileError(true));
          // The style has no sprite: its icons are drawn the first time a visible symbol needs one.
          basemap.on("styleimagemissing", ({ id }) => {
            const image = drawMapIcon(id);
            if (image && !basemap.hasImage(id))
              basemap.addImage(id, image, { pixelRatio: MAP_ICON_PIXEL_RATIO });
          });
          basemap.on("data", (event) => {
            if (event.dataType === "source" && "tile" in event && event.tile)
              setTileError(false);
          });
        } else {
          L.tileLayer(FALLBACK_TILE_URL, {
            maxZoom: 19,
            updateWhenIdle: true,
            keepBuffer: 1,
          })
            .on("tileerror", () => setTileError(true))
            .on("tileload", () => setTileError(false))
            .addTo(map);
        }
        map.on("click", (event: Leaflet.LeafletMouseEvent) => {
          // Overview lines are thin and often overlap, so they are hit-tested here with a finger-sized
          // tolerance instead of listening on the SVG paths, which would yield only the topmost one.
          const rt = runtime.current;
          if (rt && handlers.current.onWalks && rt.walkPaths.size) {
            const lines = [...rt.walkPaths].map(([key, { source }]) => ({ key, pixels: source.map(([lat, lon]) => map.latLngToContainerPoint([lat, lon])) }));
            const hits = walksAtPoint(event.containerPoint, lines);
            if (hits.length) { handlers.current.onWalks(hits); return; }
          }
          handlers.current.onPoint({
            lat: event.latlng.lat,
            lon: event.latlng.lng,
          });
        });
        // Route and position colours are tokens; Leaflet draws SVG attributes, so they are read once here.
        const style = getComputedStyle(container.current);
        const token = (name: string) => style.getPropertyValue(name).trim();
        const view = createMapView(map);
        const routeColor = token("--route-line");
        // The route sits above the basemap and under the markers, in two panes: CSS opacity of a
        // pane fades its casing and line as one picture, so the casing never shows through the line.
        const routePane = map.createPane("route");
        routePane.style.zIndex = "410";
        routePane.classList.add(styles.routePane);
        // Separate pane guarantees that even selected food stays below every story.
        const foodPane = map.createPane("food");
        foodPane.style.zIndex = "590";
        const activePane = map.createPane("routeActive");
        activePane.style.zIndex = "420";
        activePane.classList.add(styles.routePane);
        // Overview walks lie under a walk's own route: they are a background, the route is the task.
        const walkPane = map.createPane("walks");
        walkPane.style.zIndex = "402";
        walkPane.classList.add(styles.walkPane);
        const walkSelectedPane = map.createPane("walkSelected");
        walkSelectedPane.style.zIndex = "405";
        walkSelectedPane.classList.add(styles.walkSelectedPane);
        runtime.current = {
          L,
          map,
          view,
          colors: { route: routeColor, walking: token("--map-orange") || routeColor, casing: token("--surface-island"), user: token("--user-position"),
            walks: Array.from({ length: WALK_OVERVIEW_COLORS }, (_, index) => token(`--walk-overview-${index + 1}`)) },
          markers: L.layerGroup().addTo(map),
          clusters: createMapClusters(L, {
            className: styles.cluster,
            spiderLegColor: routeColor,
          }, {}, locale).addTo(map),
          markerById: new Map(),
          position: L.layerGroup().addTo(map),
          route: L.layerGroup().addTo(map),
          chevrons: L.layerGroup().addTo(map),
          routePane,
          // A pane gets a renderer of its own with the default padding; the map-level renderer option does not reach it.
          renderers: {
            route: L.svg({ pane: "route", padding: ROUTE_RENDER_PADDING }),
            routeActive: L.svg({ pane: "routeActive", padding: ROUTE_RENDER_PADDING }),
            walks: L.svg({ pane: "walks", padding: ROUTE_RENDER_PADDING }),
            walkSelected: L.svg({ pane: "walkSelected", padding: ROUTE_RENDER_PADDING }),
          },
          walkPane,
          walkLayer: L.layerGroup().addTo(map),
          walkSelection: L.layerGroup().addTo(map),
          walkPaths: new Map(),
          activePath: null,
        };
        // Chevrons are spaced in screen pixels; panning keeps layer pixels, zooming does not.
        map.on("zoomend", () => { if (runtime.current) drawChevrons(runtime.current); });
        const reportViewport = () => {
          clearTimeout(viewportTimer);
          viewportTimer = setTimeout(() => {
            if (!disposed && handlers.current.onViewport && map.getSize().x > 0 && map.getSize().y > 0)
              handlers.current.onViewport({ ...catalogArea(map), zoom: map.getZoom(), center: { lat: map.getCenter().lat, lon: map.getCenter().lng } });
          }, 160);
        };
        map.on("moveend resize", reportViewport);
        reportViewport();
        observer = new ResizeObserver(() => {
          if (disposed) return;
          map.invalidateSize();
          view.resized();
        });
        observer.observe(container.current);
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setMapError(true);
      });
    return () => {
      disposed = true;
      clearTimeout(viewportTimer);
      observer?.disconnect();
      runtime.current?.view.dispose();
      runtime.current?.clusters.dispose();
      const map = runtime.current?.map;
      if (map) {
        saveView?.();
        // Leaflet may emit a delayed resize event after remove().
        if (saveView) map.off("moveend zoomend", saveView);
        map.remove();
      }
      runtime.current = null;
    };
  }, [viewState, locale]);

  // Markers are updated by id instead of being rebuilt: playback re-renders the
  // map often, and a rebuilt marker would drop keyboard focus.
  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !ready) return;
    const wanted = new Set(items.map((item) => item.id));
    for (const [id, entry] of rt.markerById)
      if (!wanted.has(id)) {
        (entry.clustered ? rt.clusters : rt.markers).removeLayer(entry.marker);
        rt.markerById.delete(id);
      }
    const additions: Leaflet.Marker[] = [];
    for (const item of items) {
      const active = item.id === selectedId;
      const clustered = item.clusterable === true && !item.foodKind && !item.parking && !active;
      const variant = markerLook(item, active);
      const look = JSON.stringify([item.title, variant.kind, variant.label, item.foodKind, item.parking, active]);
      const position: [number, number] = [item.location.lat, item.location.lon];
      const existing = rt.markerById.get(item.id);
      if (existing) {
        // Spiderfying moves the marker temporarily; compare source coordinates.
        const current = existing.location;
        if (current.lat !== position[0] || current.lon !== position[1]) {
          existing.marker.setLatLng(position);
          existing.location = { ...item.location };
        }
        if (existing.look === look && existing.clustered === clustered)
          continue;
      }
      const icon = rt.L.divIcon({
        className: cx(MARKER_CLASS[variant.kind], active && styles.selected),
        // Marker contents are a stop number or nothing, never upstream HTML.
        html: item.foodKind ? foodMarkerSvg(item.foodKind) : `<span>${variant.label}</span>`,
        iconSize: [variant.size, variant.size],
        iconAnchor: [variant.size / 2, variant.size / 2],
      });
      let marker = existing?.marker;
      if (marker) {
        // A div icon reuses its element, so focus and listeners survive the update.
        Object.assign(marker.options, { title: item.title, alt: item.title });
        marker
          .setIcon(icon)
          .setZIndexOffset(variant.zIndex);
        // Leaflet sets the title only on a new element: a reused one would keep the old stop's name.
        marker.getElement()?.setAttribute("title", item.title);
      } else {
        marker = rt.L.marker(position, {
          icon,
          title: item.title,
          alt: item.title,
          keyboard: true,
          pane: item.foodKind ? "food" : "markerPane",
          zIndexOffset: variant.zIndex,
          bubblingMouseEvents: false,
        });
        marker.on("click", () => handlers.current.onSelect(item.id));
        if (item.foodKind) marker.on("keydown", (event: Leaflet.LeafletKeyboardEvent) => {
          if (!["Enter", " "].includes(event.originalEvent.key)) return;
          event.originalEvent.preventDefault();
          handlers.current.onSelect(item.id);
        });
        marker.on("add", () => {
          const element = marker?.getElement();
          const selected = handlers.current.selectedId === item.id;
          // The variant may have changed since creation: read the current one.
          const dataMarker = runtime.current?.markerById.get(item.id)?.dataMarker;
          element?.setAttribute("aria-pressed", String(selected));
          if (dataMarker) element?.setAttribute("data-marker", dataMarker);
          element?.setAttribute("data-selected", String(selected));
        });
      }
      if (!existing || existing.clustered !== clustered) {
        const hadFocus = marker.getElement() === document.activeElement;
        if (existing)
          (existing.clustered ? rt.clusters : rt.markers).removeLayer(marker);
        if (clustered) additions.push(marker);
        else rt.markers.addLayer(marker);
        if (hadFocus) marker.getElement()?.focus({ preventScroll: true });
      }
      const element = marker.getElement();
      element?.setAttribute("aria-pressed", String(active));
      element?.setAttribute("data-marker", variant.dataMarker);
      element?.setAttribute("data-selected", String(active));
      rt.markerById.set(item.id, {
        marker,
        look,
        dataMarker: variant.dataMarker,
        clustered,
        location: { ...item.location },
      });
    }
    rt.clusters.addLayers(additions);
  }, [items, selectedId, ready]);

  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !ready || !focus) return;
    // A remount must not replay the old selection over a manually moved view.
    if (focus === appliedFocus.current) return;
    appliedFocus.current = focus;
    rt.view.focus(focus);
  }, [focus, ready]);

  const activeFrom = activeLeg?.[0] ?? -1;
  const activeTo = activeLeg?.[1] ?? -1;
  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !ready) return;
    rt.route.clearLayers();
    const active = activeFrom >= 0 && activeTo > activeFrom ? [activeFrom, activeTo] as const : null;
    rt.routePane.classList.toggle(styles.routeDim, active !== null);
    if (routeSegments?.length) {
      rt.routePane.classList.remove(styles.routeDim);
      rt.activePath = null;
      drawChevrons(rt);
      const stroke = { lineCap: "round", lineJoin: "round", interactive: false, pane: "route", renderer: rt.renderers.route } as const;
      const all: [number, number][] = [];
      for (const segment of routeSegments) {
        if (segment.geometry.length < 2) continue;
        const points = segment.geometry.map(point => [point.lat, point.lon] as [number, number]);
        all.push(...points);
        rt.L.polyline(points, { ...stroke, color: rt.colors.casing, weight: segment.mode === "driving" ? 10 : 8, opacity: 1 }).addTo(rt.route);
        const line = rt.L.polyline(points, {
          ...stroke,
          color: segment.mode === "driving" ? rt.colors.route : rt.colors.walking,
          weight: segment.mode === "driving" ? 6 : 4,
          opacity: 1,
          ...(segment.mode === "walking" ? { dashArray: "3 6" } : {}),
        }).addTo(rt.route);
        line.getElement()?.setAttribute("data-route-mode", segment.mode);
      }
      if (fitGeometry && all.length) { rt.view.fit(rt.L.latLngBounds(all)); routeFitted.current = true; }
      else if (routeFitted.current) { rt.view.clearFit(); routeFitted.current = false; }
      return;
    }
    const runs = geometry ? routeRuns(geometry.length, tunnels, active) : [];
    const points = (geometry ?? []).map((p) => [p.lat, p.lon] as [number, number]);
    rt.activePath = active ? points.slice(active[0], active[1] + 1) : null;
    drawChevrons(rt);
    if (!runs.length) {
      if (routeFitted.current) rt.view.clearFit();
      routeFitted.current = false;
      return;
    }
    const stroke = { lineCap: "round", lineJoin: "round", interactive: false } as const;
    for (const part of ["rest", "active"] as const) {
      const own = runs.filter((run) => run.active === (part === "active"));
      const pane = part === "active" ? "routeActive" : "route";
      const renderer = rt.renderers[pane];
      // A light casing under the green line: the same light rim as the markers, legible over any basemap.
      // All casings of a pane go first, so a casing never covers the line where two runs meet.
      for (const run of own)
        rt.L.polyline(points.slice(run.from, run.to + 1), { ...stroke, pane, renderer, color: rt.colors.casing, weight: 9, opacity: 1 }).addTo(rt.route);
      for (const run of own) {
        const line = rt.L.polyline(points.slice(run.from, run.to + 1), {
          ...stroke, pane, renderer, color: rt.colors.route, weight: 5, opacity: 1,
          // Underpasses and arches are not visible from above: dashes on the solid casing.
          ...(run.covered ? { dashArray: ROUTE_COVERED_DASH, lineCap: "butt" as const } : {}),
        }).addTo(rt.route);
        const element = line.getElement();
        element?.setAttribute("data-route", "");
        element?.setAttribute("data-route-part", part);
        if (run.covered) element?.setAttribute("data-route-covered", "");
      }
    }
    if (fitGeometry) {
      rt.view.fit(rt.L.latLngBounds(points));
      routeFitted.current = true;
    } else if (routeFitted.current) {
      rt.view.clearFit();
      routeFitted.current = false;
    }
  }, [geometry, routeSegments, tunnels, activeFrom, activeTo, fitGeometry, ready]);

  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !ready || !fitTarget?.points.length) return;
    // From now on the view belongs to this target; redrawing the route must not clear it.
    routeFitted.current = false;
    const { points, keepUserView } = fitTarget;
    if (points.length === 1) rt.view.focus({ ...points[0] }, { keepUserView });
    else rt.view.fit(rt.L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number])), { keepUserView });
  }, [fitTarget, ready]);

  useEffect(() => {
    runtime.current?.view.setInsets(insets);
  }, [insets, ready]);

  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !ready) return;
    const wanted = new Map((walkLines ?? []).map((walk) => [walk.key, walk]));
    for (const [key, entry] of rt.walkPaths) {
      const next = wanted.get(key);
      if (next && next.line === entry.source && next.colorIndex === entry.colorIndex) continue;
      // removeLayer, not path.remove(): the group would otherwise keep every dropped line until unmount.
      rt.walkLayer.removeLayer(entry.path);
      rt.walkPaths.delete(key);
    }
    for (const walk of wanted.values()) {
      if (rt.walkPaths.has(walk.key)) continue;
      const path = rt.L.polyline(walk.line.map(([lat, lon]) => [lat, lon] as [number, number]), {
        pane: "walks", renderer: rt.renderers.walks, interactive: false,
        color: rt.colors.walks[walk.colorIndex - 1] ?? rt.colors.route, weight: 3, opacity: 0.9,
        dashArray: WALK_LINE_DASH, lineCap: "round", lineJoin: "round",
      }).addTo(rt.walkLayer);
      path.getElement()?.setAttribute("data-walk-line", walk.key);
      rt.walkPaths.set(walk.key, { path, source: walk.line, colorIndex: walk.colorIndex });
    }
  }, [walkLines, ready]);

  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !ready) return;
    rt.walkSelection.clearLayers();
    const entry = selectedWalk ? rt.walkPaths.get(selectedWalk) : undefined;
    rt.walkPane.classList.toggle(styles.walkDim, Boolean(entry));
    if (!entry || !selectedWalk) return;
    const points = entry.source.map(([lat, lon]) => [lat, lon] as [number, number]);
    const stroke = { pane: "walkSelected", renderer: rt.renderers.walkSelected, interactive: false, lineCap: "round", lineJoin: "round", opacity: 1 } as const;
    // The same light casing as the route keeps the chosen walk legible over the faded others.
    rt.L.polyline(points, { ...stroke, color: rt.colors.casing, weight: 8 }).addTo(rt.walkSelection);
    rt.L.polyline(points, { ...stroke, color: rt.colors.walks[entry.colorIndex - 1] ?? rt.colors.route, weight: 5 })
      .addTo(rt.walkSelection)
      .getElement()
      ?.setAttribute("data-walk-selected", selectedWalk);
  }, [selectedWalk, walkLines, ready]);

  useEffect(() => {
    const rt = runtime.current;
    if (!rt || !ready) return;
    rt.position.clearLayers();
    if (!user) return;
    // Keep the user's position visually distinct from story pins.  A custom
    // icon is more reliable than a tiny circleMarker on high-DPI/mobile maps.
    rt.L.circle([user.lat, user.lon], {
      radius: Math.min(Math.max(user.accuracyM, 20), 5000),
      color: rt.colors.user,
      weight: 2,
      fillColor: rt.colors.user,
      fillOpacity: 0.16,
      interactive: false,
    }).addTo(rt.position);
    const icon = rt.L.divIcon({
      className: styles.userPosition,
      html: '<span aria-hidden="true"></span>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    rt.L.marker([user.lat, user.lon], {
      icon,
      interactive: false,
      zIndexOffset: 1000,
    })
      .addTo(rt.position)
      .getElement()
      ?.setAttribute("data-marker", "user");
  }, [user, ready]);

  return (
    <div
      ref={container}
      className={styles.map}
      data-region="map"
      role="region"
      aria-label={
        mapLabel ??
        t("Карта историй. Выберите отметку или нажмите на дом, чтобы подготовить историю.")
      }
    />
  );
}
