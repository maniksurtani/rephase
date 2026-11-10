import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import type { FlightCandidate, FlightLeg, FlightLookupResult } from '../lib/types';
import { ApiError, lookupFlight } from '../lib/api';
import { FlightLookupDialog } from './FlightLookupDialog';

export interface FlightQuery {
  flightNumber: string;
  date: string;
}

export function FlightLookup({
  query: input,
  onQueryChange,
  accountId,
  available,
  onApply,
  onEnterManually,
}: {
  query: FlightQuery;
  onQueryChange: (query: FlightQuery) => void;
  accountId: string | null;
  available: boolean;
  onApply: (patch: Partial<FlightLeg>, candidate: FlightCandidate) => void;
  onEnterManually: () => void;
}) {
  const [result, setResult] = useState<FlightLookupResult | null>(null);
  const [error, setError] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const request = useRef(0);
  const lookupButton = useRef<HTMLButtonElement>(null);
  const numberInput = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      request.current++;
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    request.current++;
    controller.current?.abort();
    setResult(null);
    setProblem(null);
    setError('');
    setBusy(false);
  }, [input.flightNumber, input.date, accountId, available]);
  async function lookup() {
    if (!accountId || !available || !input.flightNumber.trim() || !input.date) return;
    controller.current?.abort();
    controller.current = new AbortController();
    const version = ++request.current;
    setBusy(true);
    setError('');
    setResult(null);
    setProblem(null);
    try {
      // A previous leg's origin must never narrow a newly entered flight number.
      const data = await lookupFlight(
        accountId,
        input.flightNumber,
        input.date,
        undefined,
        controller.current.signal,
      );
      if (request.current === version) setResult(data);
    } catch (cause) {
      if (request.current !== version) return;
      if (cause instanceof ApiError && cause.status === 400 && !cause.serviceUnavailable)
        setProblem(cause.message);
      else
        setError(
          cause instanceof Error
            ? cause.message
            : 'Flight lookup is unavailable. You can enter the flight manually.',
        );
    } finally {
      if (request.current === version) setBusy(false);
    }
  }
  function apply(candidate: FlightCandidate) {
    if (!result) return;
    onApply(
      {
        departureDisambiguation: undefined,
        arrivalDisambiguation: undefined,
        takeoffDateTime: undefined,
        landingDateTime: undefined,
        flightNumber: candidate.flightNumber,
        departureAirport: candidate.departureAirport,
        arrivalAirport: candidate.arrivalAirport,
        departureDateTime: candidate.departureDateTime,
        arrivalDateTime: candidate.arrivalDateTime,
        departureTimeZone: candidate.departureTimeZone,
        arrivalTimeZone: candidate.arrivalTimeZone,
        aircraft: candidate.aircraft,
        ...(candidate.departureDisambiguation
          ? { departureDisambiguation: candidate.departureDisambiguation }
          : {}),
        ...(candidate.arrivalDisambiguation
          ? { arrivalDisambiguation: candidate.arrivalDisambiguation }
          : {}),
        ...(candidate.takeoffDateTime ? { takeoffDateTime: candidate.takeoffDateTime } : {}),
        ...(candidate.landingDateTime ? { landingDateTime: candidate.landingDateTime } : {}),
        flightSource: 'aerodatabox',
        flightFetchedAt: result.fetchedAt,
        providerRecordConfirmed: true,
      },
      candidate,
    );
    setResult(null);
  }
  return (
    <div className="flight-lookup">
      <div className="flight-search-fields field-grid">
        <label className="field flight-number-field">
          <span>Flight number</span>
          <input
            ref={numberInput}
            value={input.flightNumber}
            onChange={(event) => onQueryChange({ ...input, flightNumber: event.target.value })}
            placeholder="e.g. QF 103"
            maxLength={20}
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Departure date at the departure airport</span>
          <input
            type="date"
            value={input.date}
            onChange={(event) => onQueryChange({ ...input, date: event.target.value })}
          />
        </label>
      </div>
      <div className="flight-lookup-actions">
        <button
          ref={lookupButton}
          type="button"
          className="button primary"
          disabled={!available || !accountId || busy || !input.date || !input.flightNumber.trim()}
          onClick={() => void lookup()}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}{' '}
          {busy ? 'Looking up flight…' : 'Look up flight'}
        </button>
        {busy && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              request.current++;
              controller.current?.abort();
              setBusy(false);
            }}
          >
            Cancel lookup
          </button>
        )}
      </div>
      {!accountId ? (
        <p className="flight-lookup-note">
          Sign in with Google to look up a flight, or enter it manually.
        </p>
      ) : !available ? (
        <p className="flight-lookup-note">
          Flight lookup is currently unavailable. Enter your flight manually.
        </p>
      ) : (
        <p className="flight-lookup-note">Use the departure airport’s local date.</p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {(result || problem) && (
        <FlightLookupDialog
          result={result}
          problem={problem}
          onAccept={apply}
          onReject={() => {
            setResult(null);
            setProblem(null);
          }}
          onEnterManually={() => {
            setResult(null);
            setProblem(null);
            onEnterManually();
          }}
          returnFocusTo={result?.candidates.length ? lookupButton.current : numberInput.current}
        />
      )}
    </div>
  );
}
