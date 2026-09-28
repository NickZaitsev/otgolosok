export type StorySourceRef = { url?: unknown; publisher?: unknown };
export type SourceAttribution = { url: string; label: string };

const OPEN_DATA_LABEL = "Портал открытых данных Правительства Москвы";

/**
 * The data.mos.ru licence requires a link to the portal wherever its data is used,
 * so a story built on an open-data record names the portal on its card.
 */
export function openDataAttribution(sources: readonly StorySourceRef[] | undefined): SourceAttribution | undefined {
  const source = sources?.find(item => item.publisher === "data.mos.ru" && typeof item.url === "string" && item.url.startsWith("https://data.mos.ru/"));
  return source ? { url: source.url as string, label: OPEN_DATA_LABEL } : undefined;
}
