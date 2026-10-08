import editorial from "../../../backend/place-images-editorial.json";
import { parsePlacePhoto, type PlacePhoto } from "./place-story";

/** Редакционные фото доступны и у остановок с рассказом прогулки, без опубликованной карточки места. */
export function placePhotoGallery(placeId?: string, photo?: PlacePhoto): PlacePhoto[] {
  const entry = placeId ? (editorial as Record<string, unknown>)[placeId] : undefined;
  const primary = photo ?? parsePlacePhoto(entry);
  const gallery = entry && typeof entry === "object" && "gallery" in entry && Array.isArray(entry.gallery)
    ? entry.gallery.map(parsePlacePhoto).filter((item): item is PlacePhoto => item !== undefined) : [];
  const seen = new Set<string>();
  return [...(primary ? [primary] : []), ...gallery].filter(item => {
    if (seen.has(item.src)) return false;
    seen.add(item.src);
    return true;
  });
}
