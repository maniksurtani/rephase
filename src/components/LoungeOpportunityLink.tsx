import { Armchair, ArrowUpRight } from 'lucide-react';
import type { LoungeFlightContext } from '../lib/lounge-windows';

/** A quiet shortcut; visit assumptions belong in Explorer rather than the plan. */
export function LoungeOpportunityLink({
  opportunity,
  onExplore,
  compact = false,
}: {
  opportunity: LoungeFlightContext;
  onExplore: (opportunity: LoungeFlightContext) => void;
  compact?: boolean;
}) {
  return (
    <div className="flight-lounge-link" data-flight-id={opportunity.legId}>
      <button
        type="button"
        className="lounge-plan-link"
        aria-label={`Explore lounges in ${opportunity.airport}`}
        onClick={() => onExplore(opportunity)}
      >
        <Armchair size={15} aria-hidden="true" />
        <span>
          {compact ? 'Lounges' : 'Lounge Explorer'}{' '}
          <span className="lounge-link-airport">
            {compact ? '' : '· '}
            {opportunity.airport}
          </span>
        </span>
        {!compact && <ArrowUpRight size={13} aria-hidden="true" />}
      </button>
    </div>
  );
}
