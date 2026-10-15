import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import type { FlightCandidate, FlightLeg, FlightLookupResult } from '../lib/types';
import { lookupFlight } from '../lib/auth';
import { aircraftLabel } from '../lib/aircraft';

export interface FlightQuery { flightNumber: string; date: string }

export function FlightLookup({ query: input, onQueryChange, accountId, available, onApply }: {
  query: FlightQuery;
  onQueryChange: (query: FlightQuery) => void;
  accountId: string | null;
  available: boolean;
  onApply: (patch: Partial<FlightLeg>, candidate: FlightCandidate) => void;
}) {
  const [result, setResult] = useState<FlightLookupResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const request = useRef(0);
  useEffect(() => () => { request.current++; controller.current?.abort(); }, []);
  useEffect(() => {
    request.current++; controller.current?.abort();
    setResult(null); setError(''); setBusy(false); setConfirmed(false);
  }, [input.flightNumber, input.date, accountId, available]);
  async function lookup() {
    if (!accountId || !available || !input.flightNumber.trim() || !input.date) return;
    controller.current?.abort(); controller.current = new AbortController();
    const version = ++request.current;
    setBusy(true); setError(''); setResult(null); setConfirmed(false);
    try {
      // A previous leg's origin must never narrow a newly entered flight number.
      const data = await lookupFlight(accountId, input.flightNumber, input.date, undefined, controller.current.signal);
      if (request.current === version) setResult(data);
    } catch (cause) {
      if (request.current === version) setError(cause instanceof Error ? cause.message : 'Flight lookup is unavailable. You can enter the flight manually.');
    } finally { if (request.current === version) setBusy(false); }
  }
  function apply(candidate: FlightCandidate) {
    if (!confirmed || !result) return;
    onApply({
      departureDisambiguation: undefined, arrivalDisambiguation: undefined,
      takeoffDateTime: undefined, landingDateTime: undefined,
      flightNumber: candidate.flightNumber, departureAirport: candidate.departureAirport, arrivalAirport: candidate.arrivalAirport,
      departureDateTime: candidate.departureDateTime, arrivalDateTime: candidate.arrivalDateTime,
      departureTimeZone: candidate.departureTimeZone, arrivalTimeZone: candidate.arrivalTimeZone,
      aircraft: candidate.aircraft,
      ...(candidate.departureDisambiguation ? { departureDisambiguation: candidate.departureDisambiguation } : {}),
      ...(candidate.arrivalDisambiguation ? { arrivalDisambiguation: candidate.arrivalDisambiguation } : {}),
      ...(candidate.takeoffDateTime ? { takeoffDateTime: candidate.takeoffDateTime } : {}),
      ...(candidate.landingDateTime ? { landingDateTime: candidate.landingDateTime } : {}),
      flightSource: 'aerodatabox', flightFetchedAt: result.fetchedAt, providerRecordConfirmed: true,
    }, candidate);
    setResult(null); setConfirmed(false);
  }
  return <div className="flight-lookup">
    <div className="flight-search-fields field-grid">
      <label className="field flight-number-field"><span>Flight number</span><input value={input.flightNumber} onChange={event => onQueryChange({ ...input, flightNumber: event.target.value })} placeholder="e.g. QF 103" maxLength={20} autoCapitalize="characters" spellCheck={false}/></label>
      <label className="field"><span>Departure date at the departure airport</span><input type="date" value={input.date} onChange={event => onQueryChange({ ...input, date: event.target.value })}/></label>
    </div>
    <div className="flight-lookup-actions"><button type="button" className="button primary" disabled={!available || !accountId || busy || !input.date || !input.flightNumber.trim()} onClick={() => void lookup()}>{busy ? <LoaderCircle size={16} className="spin"/> : <Search size={16}/>} {busy ? 'Looking up flight…' : 'Look up flight'}</button>
      {busy && <button type="button" className="text-button" onClick={() => { request.current++; controller.current?.abort(); setBusy(false); }}>Cancel lookup</button>}
    </div>
    {!accountId ? <p className="flight-lookup-note">Sign in with Google to look up a flight, or enter it manually.</p> : !available ? <p className="flight-lookup-note">Flight lookup is currently unavailable. Enter your flight manually.</p> : <p className="flight-lookup-note">Use the departure airport’s local date. Check the returned schedule against your booking.</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    {result && <div className="flight-results"><p>{result.stale ? 'Cached schedule · check your booking' : 'Choose your flight'}</p>
      {result.warnings.map((warning, index) => <p className="small-copy" key={index}>{warning}</p>)}
      {!result.candidates.length ? <p>No matching flight found. Try the operating flight number or enter your flight manually.</p> : <>
        <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>This is my own booked or previously traveled trip. I will verify the schedule against my booking.</span></label>
        {result.candidates.map(candidate => <article className="flight-result" key={candidate.id}>
          <strong>{candidate.flightNumber} · {candidate.airline}</strong>
          <span>{candidate.departureAirport} → {candidate.arrivalAirport} · {Math.floor(candidate.durationMinutes / 60)}h {candidate.durationMinutes % 60}m</span>
          <span className="flight-aircraft">{aircraftLabel(candidate.aircraft) ? `Aircraft · ${aircraftLabel(candidate.aircraft)}` : 'Aircraft type not provided'}</span>
          <span>Departs {candidate.departureDateTime.slice(0, 16).replace('T', ' ')} ({candidate.departureTimeZone})</span>
          <span>Arrives {candidate.arrivalDateTime.slice(0, 16).replace('T', ' ')} ({candidate.arrivalTimeZone})</span>
          {candidate.operatingFlightNumber && <span>Operated as {candidate.operatingFlightNumber}</span>}
          <button type="button" className="button secondary" disabled={!confirmed} onClick={() => apply(candidate)}>Use this flight</button>
        </article>)}
      </>}
      <a href="https://aerodatabox.com/" target="_blank" rel="noopener noreferrer">Flight data by AeroDataBox</a>
    </div>}
  </div>;
}
