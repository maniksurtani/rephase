import { createPortal } from 'react-dom';
import type { FlightCandidate, FlightLookupResult } from '../lib/types';
import { aircraftLabel } from '../lib/aircraft';
import { Dialog } from './Dialog';

export function FlightLookupDialog({
  result,
  onAccept,
  onReject,
  onEnterManually,
  problem,
  returnFocusTo,
}: {
  result: FlightLookupResult | null;
  onAccept: (candidate: FlightCandidate) => void;
  onReject: () => void;
  onEnterManually: () => void;
  problem: string | null;
  returnFocusTo: HTMLElement | null;
}) {
  const candidates = result?.candidates ?? [];
  const noMatches = candidates.length === 0;
  const title = problem
    ? 'Check your flight details'
    : noMatches
      ? 'Flight not found'
      : candidates.length === 1
        ? 'Confirm your flight'
        : 'Choose your flight';
  // The editor is already a dialog. A portal keeps this layer outside its inert backdrop.
  return createPortal(
    <Dialog
      title={title}
      onClose={onReject}
      dismissible={false}
      returnFocusTo={returnFocusTo}
      className="modal flight-confirmation"
    >
      <header className="modal-header">
        <h2 tabIndex={-1} data-initial-focus>
          {title}
        </h2>
      </header>
      {noMatches && (
        <p className="modal-intro">
          {problem ??
            'No flight matched that number and departure date. Check the details and try again, or enter your flight manually.'}
        </p>
      )}
      {!noMatches && result?.stale && (
        <p className="flight-lookup-note">Cached schedule · updates unavailable</p>
      )}
      <div className="flight-results">
        {candidates.map((candidate) => (
          <article className="flight-result" key={candidate.id}>
            <strong>
              {candidate.flightNumber} · {candidate.airline}
            </strong>
            <span>
              {candidate.departureAirport} → {candidate.arrivalAirport} ·{' '}
              {Math.floor(candidate.durationMinutes / 60)}h {candidate.durationMinutes % 60}m
            </span>
            <span className="flight-aircraft">
              {aircraftLabel(candidate.aircraft)
                ? `Aircraft · ${aircraftLabel(candidate.aircraft)}`
                : 'Aircraft type not provided'}
            </span>
            <span>
              Departs {candidate.departureDateTime.slice(0, 16).replace('T', ' ')} (
              {candidate.departureTimeZone})
            </span>
            <span>
              Arrives {candidate.arrivalDateTime.slice(0, 16).replace('T', ' ')} (
              {candidate.arrivalTimeZone})
            </span>
            {candidate.operatingFlightNumber && (
              <span>Operated as {candidate.operatingFlightNumber}</span>
            )}
            <button type="button" className="button primary" onClick={() => onAccept(candidate)}>
              Use this flight
            </button>
          </article>
        ))}
      </div>
      <footer className="modal-footer">
        {noMatches ? (
          <>
            <button type="button" className="button secondary" onClick={onEnterManually}>
              Enter manually
            </button>
            <button type="button" className="button primary" onClick={onReject}>
              Try again
            </button>
          </>
        ) : (
          <button type="button" className="button secondary" onClick={onReject}>
            Reject
          </button>
        )}
      </footer>
    </Dialog>,
    document.body,
  );
}
