import { IMPROVEMENT_ISSUES, improvementIssueLabels, type ImprovementIssue } from "./model";
import styles from "./improvement-dialog.module.css";
import { useI18n } from "@/lib/i18n/provider";

/** Общий список причин для прогулки и отдельного места. */
export function ImprovementFields({ selected, busy, onChange }: { selected: ImprovementIssue[]; busy: boolean; onChange: (issues: ImprovementIssue[]) => void }) {
  const { t } = useI18n();
  return <fieldset className={styles.options}>
    <legend>{t("Отметьте, что мешает. Можно несколько вариантов.")}</legend>
    {IMPROVEMENT_ISSUES.map(issue => <label key={issue} className={styles.option}>
      <input type="checkbox" checked={selected.includes(issue)} disabled={busy} onChange={event => onChange(event.target.checked ? [...selected, issue] : selected.filter(item => item !== issue))} />
      <span>{t(improvementIssueLabels[issue])}</span>
    </label>)}
  </fieldset>;
}
