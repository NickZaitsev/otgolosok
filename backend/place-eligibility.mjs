const informativeName = value => typeof value === "string" && value.trim().length >= 4 && !/^[А-ЯЁA-Z](?:\.\s*[А-ЯЁA-Z])?\.?(?:\s+[А-ЯЁа-яё-]+)?$/u.test(value.trim());

export const CONTENT_PROFILE_VERSION = "2";
export function assessPlaceEligibility(place) {
  const tags=place?.tags??{},signals=[];
  if(Number.isFinite(place?.location?.lat)&&Number.isFinite(place?.location?.lon))signals.push("coordinates");
  if(tags.wikidata||tags.wikipedia)signals.push("object_identifier");
  if(informativeName(place?.name))signals.push("informative_name");
  if(place?.address)signals.push("postal_address");
  if(tags.historic||tags.tourism||tags.memorial||tags.artwork_type||tags.leisure)signals.push("specific_type");
  const reasons=[];if(!signals.includes("coordinates"))reasons.push("missing_coordinates");
  if(!signals.includes("object_identifier")&&!(signals.includes("informative_name")&&signals.includes("specific_type")&&(signals.includes("postal_address")||tags.subject||tags["subject:wikidata"])))reasons.push("weak_identity");
  return {eligible:reasons.length===0,reasons,signals};
}
