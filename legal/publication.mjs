import publication from "./publication.json" with { type: "json" };

export const TERMS_VERSION = "2026-10-08";
export const LEGAL_READY = publication.published === true &&
  [publication.operator.name, publication.operator.address, publication.operator.email,
    publication.hosting.provider, publication.hosting.country].every(value => value.trim().length > 0);
export { publication };
