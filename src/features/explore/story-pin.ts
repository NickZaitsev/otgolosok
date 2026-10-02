import type { MapItem } from "./explore-map";
import type { CatalogPoint } from "./map-cells";
import { isPlaceId } from "./place-link";
import type { PlaceHeader, PlaceStory } from "./place-story";
import type { SourceAttribution } from "./source-attribution";

/** A story on the home map: a walk chapter, a prepared job or a catalog place. */
export type StoryPin = MapItem & {
  address: string;
  duration?: number;
  chapter?: number;
  jobId?: string;
  placeId?: string;
  audioUrl?: string;
  status?: string;
  paragraphs?: string[];
  attribution?: SourceAttribution;
  /** Sources a prepared story was checked against. */
  sources?: Array<{ id: string; title: string; url: string; publisher: string }>;
  /** A story the user ordered: how far its preparation got and whether it can be restarted. */
  progress?: { label: string; pending: boolean; note?: string; error?: string; canRetry: boolean; retryLabel: string };
  /** A catalog place with a photo: its card keeps the preview slot while the detail loads. */
  hasPhoto?: boolean;
};

/**
 * Whether the story card can expand to a full-screen reading view: a catalog place (its text loads with the card)
 * or a story that already has text. Walk parts and stories still being prepared keep the plain card.
 */
export function isExpandableStory(pin: StoryPin): boolean {
  if (pin.chapter !== undefined) return false;
  const catalog = pin.placeId !== undefined && pin.jobId === undefined;
  return catalog || Boolean(pin.paragraphs?.length);
}

/** A published catalog place: the only story with its own URL (`/?place=<id>`) and a shared link. */
export function isLinkablePlace(pin: StoryPin): boolean {
  return pin.chapter === undefined && pin.jobId === undefined && pin.placeId === pin.id && isPlaceId(pin.id);
}

const catalogStatus = (durationSec: number | null | undefined) => durationSec != null ? "Готово к прослушиванию" : "Текст готов";

/** A catalog point on the map. The text, sources and audio load when its sheet opens (usePlaceStory). */
export function catalogPin(point: CatalogPoint): StoryPin {
  return { id: point.id, placeId: point.id, title: point.title, address: point.address, location: point.location,
    duration: point.durationSec ?? undefined, status: catalogStatus(point.durationSec), hasPhoto: point.photo, clusterable: true };
}

/** A place opened by a link before its map cell has loaded: the same pin, built from the place detail. */
export function linkedPlacePin(id: string, header: PlaceHeader, story: PlaceStory): StoryPin {
  return { id, placeId: id, title: header.title, address: header.address, location: header.location,
    duration: story.durationSec, status: catalogStatus(story.durationSec), hasPhoto: Boolean(story.photo), clusterable: true };
}
