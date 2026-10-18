import { ChevronRight, ExternalLink, Info } from 'lucide-react';
import type { PlanAction } from '../lib/types';

/** Keep timing visible while the supporting usage information stays optional. */
export function MelatoninGuidance({ action }: { action: PlanAction }) {
  return (
    <details className="melatonin-guidance">
      <summary className="why-button">
        <Info size={13} aria-hidden="true" />
        Melatonin guidance
        <ChevronRight size={13} aria-hidden="true" />
      </summary>
      <div className="action-explanation">
        <p>{action.detail}</p>
        {action.dose && <span className="dose-label">Informational dose range: {action.dose}</span>}
        <p>{action.reason}</p>
        {action.evidenceUrl && (
          <a href={action.evidenceUrl} target="_blank" rel="noreferrer">
            Read the source <ExternalLink size={12} />
          </a>
        )}
      </div>
    </details>
  );
}
