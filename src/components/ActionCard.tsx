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

/** Presentation only: recording still uses the original action and its saved ID. */
export interface SleepEpisodePresentation {
  start: number;
  end: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

function sleepEpisodeLabel(episode: SleepEpisodePresentation): string {
  const minutes = Math.round((episode.end - episode.start) / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const duration = hours ? `${hours} h${remainder ? ` ${remainder} min` : ''}` : `${minutes} min`;
  return `${duration} total${episode.continuesBefore ? ' · continued' : ''}${episode.continuesAfter ? ' · continues next day' : ''}`;
}

function ActionTravelClocks({
  action,
  segment,
  sleepEpisode,
}: {
  action: PlanAction;
  segment: PlanTravelSegment;
  sleepEpisode?: SleepEpisodePresentation;
}) {
  const startInstant = sleepEpisode ? new Date(sleepEpisode.start).toISOString() : action.start;
  const endInstant = sleepEpisode ? new Date(sleepEpisode.end).toISOString() : action.end;
  return (
    <div
      className="travel-action-clocks"
      aria-label="Recommendation in origin and destination time"
    >
      {[
        { role: 'Origin', airport: segment.departureAirport, zone: segment.departureTimeZone },
        { role: 'Destination', airport: segment.arrivalAirport, zone: segment.arrivalTimeZone },
      ].map((clock) => {
        const start = travelClock(startInstant, clock.zone),
          end = travelClock(endInstant, clock.zone);
        return (
          <div className="travel-action-clock" key={clock.role}>
            <span>
              {clock.role} · {clock.airport}
            </span>
            <strong>
              <time dateTime={startInstant}>
                {start.date} {start.time}
              </time>{' '}
              –{' '}
              <time dateTime={endInstant}>
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
  sleepEpisode,
}: {
  travelSegments?: PlanTravelSegment[];
  action: PlanAction;
  compact?: boolean;
  timeline?: boolean;
  isCurrent?: boolean;
  record?: AdherenceRecord;
  onRecord?: (action: PlanAction) => void;
  sleepEpisode?: SleepEpisodePresentation;
}) {
  const [expanded, setExpanded] = useState(false);
  const relevantSegment = actionTravelSegment(action, travelSegments);
  const segment =
    relevantSegment?.departureTimeZone !== relevantSegment?.arrivalTimeZone
      ? relevantSegment
      : undefined;
  const meta = actionMeta[action.type];
  const Icon = meta.icon;
  const differentDay =
    localDate(action.start, action.timeZone) !== localDate(action.end, action.timeZone);
  return (
    <article
      className={`action-card ${meta.color} ${compact ? 'compact' : ''} ${isCurrent ? 'current' : ''}`}
      data-action-id={action.id}
      data-origin={action.origin}
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
        {action.origin === 'original-plan' && <p className="small-copy">Planned · not recorded</p>}
        {action.type === 'sleep' && sleepEpisode && (
          <p className="small-copy sleep-episode-label">{sleepEpisodeLabel(sleepEpisode)}</p>
        )}
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
        {segment && (
          <ActionTravelClocks action={action} segment={segment} sleepEpisode={sleepEpisode} />
        )}
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
