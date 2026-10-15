import { Armchair, ArrowUpRight } from 'lucide-react';
import type { LoungeOpportunity } from '../lib/lounge-windows';
import { travelClock } from '../lib/travel-clocks';

export function LoungeOpportunityLink({ opportunity, onExplore }: { opportunity: LoungeOpportunity; onExplore: (opportunity: LoungeOpportunity) => void }) {
  const from = travelClock(opportunity.start, opportunity.timeZone), until = travelClock(opportunity.end, opportunity.timeZone);
  return <div className="lounge-opportunity">
    <Armchair size={19} aria-hidden="true"/>
    <div><strong>{opportunity.kind === 'transit' ? 'Time to recharge in transit' : 'Before your flight'}</strong>
      <span>{from.date} · {from.time}–{until.time}{from.dateKey !== until.dateKey ? `, ${until.date}` : ''} · {from.zone}</span>
      <small>{opportunity.kind === 'transit' ? 'Estimated time after arrival formalities and before boarding.' : 'Assuming you arrive early; adjust your visit in Lounge Explorer.'}</small>
      <button type="button" className="text-button" onClick={() => onExplore(opportunity)}>Explore lounges in {opportunity.airport}<ArrowUpRight size={14}/></button>
    </div>
  </div>;
}
