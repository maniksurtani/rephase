import { Plane } from 'lucide-react';
import type { PlanTravelSegment } from '../lib/types';
import { travelClock } from '../lib/travel-clocks';

export function FlightSegmentCard({ segment }: { segment: PlanTravelSegment }) {
  function clockRow(instant: string, airport: string, timeZone: string, side: 'origin' | 'destination') {
    const clock = travelClock(instant, timeZone);
    return <div className={`flight-clock flight-clock-${side}`}>
      <span className="flight-clock-label">{airport} {side === 'origin' ? 'origin' : 'destination'}</span>
      <time dateTime={instant}><strong>{clock.time}</strong><span>{clock.date} · {clock.zone}</span></time>
    </div>;
  }
  return <article className="flight-segment-card" data-flight-id={segment.id} aria-label={`${segment.flightNumber ? `${segment.flightNumber} · ` : ''}${segment.departureAirport} to ${segment.arrivalAirport} flight`}>
    <header className="flight-segment-header"><Plane size={19} aria-hidden="true"/><div><span className="flight-segment-label">Flight{segment.flightNumber ? ` · ${segment.flightNumber}` : ''}</span><h3>{segment.departureAirport} <span aria-hidden="true">→</span> {segment.arrivalAirport}</h3></div></header>
    <div className="flight-segment-events">
      <section className="flight-segment-event" aria-label="Gate departure"><h4>Gate departure</h4>{clockRow(segment.departure, segment.departureAirport, segment.departureTimeZone, 'origin')}{clockRow(segment.departure, segment.arrivalAirport, segment.arrivalTimeZone, 'destination')}</section>
      <section className="flight-segment-event" aria-label="Gate arrival"><h4>Gate arrival</h4>{clockRow(segment.arrival, segment.departureAirport, segment.departureTimeZone, 'origin')}{clockRow(segment.arrival, segment.arrivalAirport, segment.arrivalTimeZone, 'destination')}</section>
    </div>
  </article>;
}
