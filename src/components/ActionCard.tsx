import { useState } from 'react';
import {
  ChevronRight,
  Coffee,
  ExternalLink,
  EyeOff,
  Info,
  Moon,
  Sparkles,
  Sun,
} from 'lucide-react';
import type { AdherenceRecord, PlanAction, PlanTravelSegment } from '../lib/types';
import { actionTravelSegment, travelClock } from '../lib/travel-clocks';
import { localDate, time, zoneName } from '../lib/display';
import { MelatoninGuidance } from './MelatoninGuidance';

export const actionMeta: Record<
  PlanAction['type'],
  { icon: typeof Sun; label: string; color: string }
> = {
  sleep: { icon: Moon, label: 'Sleep', color: 'sleep' },
  light: { icon: Sun, label: 'Seek light', color: 'light' },
  'avoid-light': { icon: EyeOff, label: 'Avoid bright light', color: 'shade' },
  caffeine: { icon: Coffee, label: 'Caffeine window', color: 'caffeine' },
  melatonin: { icon: Sparkles, label: 'Optional melatonin', color: 'melatonin' },
};
function ActionTravelClocks({
  action,
  segment,
}: {
  action: PlanAction;
  segment: PlanTravelSegment;
}) {
  return (
    <div
      className="travel-action-clocks"
      aria-label="Recommendation in origin and destination time"
    >
      {[
        { role: 'Origin', airport: segment.departureAirport, zone: segment.departureTimeZone },
        { role: 'Destination', airport: segment.arrivalAirport, zone: segment.arrivalTimeZone },
      ].map((clock) => {
        const start = travelClock(action.start, clock.zone),
          end = travelClock(action.end, clock.zone);
        return (
          <div className="travel-action-clock" key={clock.role}>
            <span>
              {clock.role} · {clock.airport}
            </span>
            <strong>
              <time dateTime={action.start}>
                {start.date} {start.time}
              </time>{' '}
              –{' '}
              <time dateTime={action.end}>
                {end.date} {end.time}
              </time>
            </strong>
            <small>
              {start.zone}
              {start.zone !== end.zone ? ` → ${end.zone}` : ''}
            </small>
          </div>
        );
      })}
    </div>
  );
}

export function ActionCard({
  action,
  compact = false,
  timeline = false,
  isCurrent = false,
  record,
  onRecord,
  travelSegments,
}: {
  travelSegments?: PlanTravelSegment[];
  action: PlanAction;
  compact?: boolean;
  timeline?: boolean;
  isCurrent?: boolean;
  record?: AdherenceRecord;
  onRecord?: (action: PlanAction) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const segment = actionTravelSegment(action, travelSegments);
  const meta = actionMeta[action.type];
  const Icon = meta.icon;
  const differentDay =
    localDate(action.start, action.timeZone) !== localDate(action.end, action.timeZone);
  return (
    <article
      className={`action-card ${meta.color} ${compact ? 'compact' : ''} ${isCurrent ? 'current' : ''}`}
      data-action-id={action.id}
      data-start={Date.parse(action.start)}
      data-end={Date.parse(action.end)}
    >
      {!timeline && (
        <div className="action-time">
          <strong>{time(action.start, action.timeZone)}</strong>
          <span>
            {time(action.end, action.timeZone)}
            {differentDay && <small> +1 day</small>}
          </span>
          {segment && <small>{zoneName(action.timeZone, action.start)}</small>}
        </div>
      )}
      <div className="action-symbol">
        <Icon size={20} />
      </div>
      <div className="action-content">
        <div className="action-title-line">
          <h3>{action.title}</h3>
          {isCurrent && <span className="live-label">Now</span>}
        </div>
        {action.type === 'melatonin' ? (
          <MelatoninGuidance action={action} />
        ) : (
          <p>{action.detail}</p>
        )}
        {action.feasibility && (
          <span className="feasibility-label">
            {action.feasibility === 'daylight'
              ? 'Daylight available'
              : action.feasibility === 'indoor'
                ? 'Indoor light needed'
                : 'Daylight uncertain'}
          </span>
        )}
        {action.dose && action.type !== 'melatonin' && (
          <span className="dose-label">Informational dose range: {action.dose}</span>
        )}
        {segment && <ActionTravelClocks action={action} segment={segment} />}
        {!compact && action.type !== 'melatonin' && (
          <button
            type="button"
            className="why-button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <Info size={13} />
            {expanded ? 'Hide explanation' : 'Why this helps'}
            <ChevronRight size={13} className={expanded ? 'rotated' : ''} />
          </button>
        )}
        {onRecord && (
          <button
            type="button"
            className="why-button record-button"
            disabled={Date.parse(action.start) > Date.now()}
            onClick={() => onRecord(action)}
          >
            {record ? `Recorded: ${record.status} · edit` : 'Record what happened'}
          </button>
        )}
        {expanded && action.type !== 'melatonin' && (
          <div className="action-explanation">
            <p>{action.reason}</p>
            {action.evidenceUrl && (
              <a href={action.evidenceUrl} target="_blank" rel="noreferrer">
                Read the source <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
