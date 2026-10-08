import { LEGAL_READY, TERMS_VERSION } from "../../../legal/publication.mjs";
import { LegalCopy, Operator, legalTitles, documentRevision, legalDraftNotice, type LegalDocumentName } from "@/lib/legal/document-content";
import { AppHeader } from "../navigation/app-header";
import { LegalLinks } from "./legal-links";
import styles from "./legal.module.css";

export {legalTitles, type LegalDocumentName};

export function LegalDocument({ name }: { name: LegalDocumentName }) {
  return <main className="ui-page"><AppHeader /><article className={styles.document} lang="ru">
    <h1>{legalTitles[name]}</h1><p>{documentRevision} · {TERMS_VERSION}</p>
    {!LEGAL_READY && <p className={styles.draft} role="note">{legalDraftNotice}</p>}
    <Operator /><LegalCopy name={name} /><LegalLinks />
  </article></main>;
}
