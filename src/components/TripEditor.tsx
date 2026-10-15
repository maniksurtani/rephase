import { useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Globe2, Info, Moon, Plane, Plus, Trash2 } from 'lucide-react';
import type { FlightCandidate, FlightLeg, Trip } from '../lib/types';
import { findAirport } from '../lib/airports';
import { createLeg } from '../lib/defaults';
import { departureTimeEdit, minuteDateTimeValue, type ArrivalDefaultState } from '../lib/flight-entry';
import { localToInstant } from '../lib/time';
import { aircraftLabel } from '../lib/aircraft';
import { AirportInput } from './AirportInput';
import { FoldChoice } from './FoldChoice';
import { FlightLookup, type FlightQuery } from './FlightLookup';
import { Modal } from './Modal';

export function TripEditor({ trip, setTrip, errors, onSave, onClose, existing, accountId, flightLookupAvailable }: { trip: Trip; setTrip: (value: Trip) => void; errors: string[]; onSave: () => void; onClose: () => void; existing: boolean; accountId:string|null; flightLookupAvailable:boolean }) {
  const arrivalDefaults = useRef(new Map<string, ArrivalDefaultState>());
  const [queries, setQueries] = useState<Record<string, FlightQuery>>({});
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const [selectedFlights, setSelectedFlights] = useState<Record<string, FlightCandidate>>({});
  const [queryErrors, setQueryErrors] = useState<string[]>([]);
  function queryFor(leg: FlightLeg): FlightQuery {
    return queries[leg.id] ?? { flightNumber: leg.flightNumber, date: leg.departureDateTime.slice(0, 10) };
  }
  function queryMatches(leg: FlightLeg) {
    const query = queryFor(leg);
    const number = (value: string) => value.toUpperCase().replace(/\s/g, '');
    return number(query.flightNumber) === number(leg.flightNumber) && query.date === leg.departureDateTime.slice(0, 10);
  }
  function changeQuery(leg: FlightLeg, query: FlightQuery, enterManual = false) {
    setQueries(value => ({ ...value, [leg.id]: query }));
    setQueryErrors([]);
    if (!manualOpen[leg.id] && !enterManual) return;
    const patch: Partial<FlightLeg> = {};
    if (query.flightNumber !== leg.flightNumber) patch.flightNumber = query.flightNumber;
    if (query.date !== leg.departureDateTime.slice(0, 10)) {
      const dateTime = query.date ? `${query.date}T${minuteDateTimeValue(leg.departureDateTime).slice(11) || '00:00'}` : '';
      const edit = departureTimeEdit(leg, dateTime, arrivalDefaults.current.get(leg.id));
      arrivalDefaults.current.set(leg.id, edit.state);
      Object.assign(patch, edit.patch);
    }
    if (Object.keys(patch).length) updateLeg(leg.id, patch);
  }
  function toggleManual(leg: FlightLeg) {
    if (!manualOpen[leg.id]) changeQuery(leg, queryFor(leg), true);
    setManualOpen(value => ({ ...value, [leg.id]: !value[leg.id] }));
  }
  function updateDeparture(leg: FlightLeg, value: string) {
    const edit = departureTimeEdit(leg, value, arrivalDefaults.current.get(leg.id));
    arrivalDefaults.current.set(leg.id, edit.state);
    setQueries(current => ({ ...current, [leg.id]: { flightNumber: queryFor(leg).flightNumber, date: value.slice(0, 10) } }));
    updateLeg(leg.id, edit.patch);
  }
  function updateArrival(leg: FlightLeg, value: string) {
    arrivalDefaults.current.set(leg.id, { mode: 'manual' });
    updateLeg(leg.id, { arrivalDateTime: value });
  }
  function updateLeg(id: string, patch: Partial<FlightLeg>) {
    const scheduleFields=['flightNumber','departureAirport','arrivalAirport','departureDateTime','arrivalDateTime','departureTimeZone','arrivalTimeZone','takeoffDateTime','landingDateTime','departureDisambiguation','arrivalDisambiguation'];
    const manualScheduleEdit = !patch.flightSource && Object.keys(patch).some(key => scheduleFields.includes(key));
    if (manualScheduleEdit) setSelectedFlights(current => {
      if (!current[id]) return current;
      const next = { ...current }; delete next[id]; return next;
    });
    setTrip({ ...trip, legs: trip.legs.map(leg => {
      if(leg.id!==id)return leg;
      const updated={...leg,...patch};
      const normalizedNumber = (value: string) => value.toUpperCase().replace(/\s/g, '');
      const changedIdentity = normalizedNumber(updated.flightNumber) !== normalizedNumber(leg.flightNumber)
        || updated.departureDateTime.slice(0, 10) !== leg.departureDateTime.slice(0, 10)
        || updated.departureAirport !== leg.departureAirport || updated.arrivalAirport !== leg.arrivalAirport;
      if (manualScheduleEdit && changedIdentity) delete updated.aircraft;
      if(manualScheduleEdit) {
        // Keep the original provider attribution after a manual correction.
        if(updated.flightSource!=='aerodatabox')updated.flightSource='manual';
        // Editing one airborne clock must preserve the other. Changes to the
        // flight's gate schedule still invalidate previously entered clocks.
        if(!('takeoffDateTime' in patch) && !('landingDateTime' in patch)) {
          delete updated.takeoffDateTime;
          delete updated.landingDateTime;
        }
      }
      if('departureDateTime' in patch && !('departureDisambiguation' in patch))delete updated.departureDisambiguation;
      if('arrivalDateTime' in patch && !('arrivalDisambiguation' in patch))delete updated.arrivalDisambiguation;
      return Object.fromEntries(Object.entries(updated).filter(([,value])=>value!==undefined)) as unknown as FlightLeg;
    }) });
  }
  function updateAirport(leg: FlightLeg, side: 'departure' | 'arrival', value: string) {
    const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const airport = findAirport(code);
    updateLeg(leg.id, { [`${side}Airport`]: code, ...(airport ? { [`${side}TimeZone`]: airport.timeZone } : {}) });
  }
  function addLeg() {
    const last = trip.legs.at(-1);
    const leg = createLeg();
    if (last) { leg.departureAirport = last.arrivalAirport; leg.departureTimeZone = last.arrivalTimeZone; }
    setTrip({ ...trip, legs: [...trip.legs, leg] });
  }
  function moveLeg(index: number, direction: number) {
    const legs = [...trip.legs];
    [legs[index], legs[index + direction]] = [legs[index + direction], legs[index]];
    setTrip({ ...trip, legs });
  }
  function save() {
    const unresolved = trip.legs.flatMap((leg, index) => !queryMatches(leg) || !leg.departureAirport || !leg.arrivalAirport || !leg.departureDateTime || !leg.arrivalDateTime
      ? [`Flight ${index + 1}: Choose a matching flight or enter its schedule manually before saving.`] : []);
    setQueryErrors(unresolved);
    if (!unresolved.length) onSave();
  }
  return <Modal title={existing ? 'Edit your journey' : 'Plan a new journey'} onClose={onClose} className="trip-editor-modal">
    <p className="modal-intro">Find each flight by its number and departure date. Add flights in travel order, including connections.</p><form onSubmit={event => { event.preventDefault(); save(); }}>
      <label className="field trip-name-field"><span>Trip name</span><input value={trip.name} onChange={event => setTrip({ ...trip, name: event.target.value })} placeholder="Tokyo, with a stop in Singapore" maxLength={100} required data-initial-focus/></label>
      {errors.length + queryErrors.length > 0 && <div className="alert error-alert" role="alert"><ul>{[...queryErrors, ...errors].map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
      <div className="flight-editor-list">{trip.legs.map((leg, index) => <section className="flight-editor-card" key={leg.id}><div className="flight-editor-heading"><span className="flight-number-badge">{index + 1}</span><h3>Flight {index + 1}</h3><div className="flight-editor-tools"><button type="button" className="icon-button" aria-label={`Move flight ${index + 1} earlier`} disabled={index === 0} onClick={() => moveLeg(index, -1)}><ArrowUpRight size={15} className="move-up"/></button><button type="button" className="icon-button" aria-label={`Move flight ${index + 1} later`} disabled={index === trip.legs.length - 1} onClick={() => moveLeg(index, 1)}><ArrowDown size={15}/></button><button type="button" className="icon-button danger-icon" aria-label={`Remove flight ${index + 1}`} disabled={trip.legs.length === 1} onClick={() => setTrip({ ...trip, legs: trip.legs.filter(value => value.id !== leg.id) })}><Trash2 size={15}/></button></div></div>
        <FlightLookup query={queryFor(leg)} onQueryChange={query => changeQuery(leg, query)} accountId={accountId} available={flightLookupAvailable} onApply={(patch, candidate) => {
          arrivalDefaults.current.set(leg.id, { mode: 'manual' });
          setQueries(value => ({ ...value, [leg.id]: { flightNumber: candidate.flightNumber, date: candidate.departureDateTime.slice(0, 10) } }));
          setSelectedFlights(value => ({ ...value, [leg.id]: candidate }));
          setManualOpen(value => ({ ...value, [leg.id]: false }));
          setQueryErrors([]); updateLeg(leg.id, patch);
        }}/>
        {queryMatches(leg) && leg.departureAirport && leg.arrivalAirport && leg.departureDateTime && leg.arrivalDateTime && <SelectedFlight leg={leg} candidate={leg.flightSource === 'aerodatabox' ? selectedFlights[leg.id] : undefined}/>}
        {!queryMatches(leg) && leg.departureAirport && leg.arrivalAirport && <p className="flight-query-pending">Choose a matching flight or enter its updated schedule manually.</p>}
        <div className="manual-flight-toggle"><button type="button" className="text-button" aria-expanded={Boolean(manualOpen[leg.id])} aria-controls={`manual-flight-${leg.id}`} onClick={() => toggleManual(leg)}>{manualOpen[leg.id] ? 'Hide manual details' : 'Enter manually'}</button></div>
        {manualOpen[leg.id] && <div className="manual-flight-details" id={`manual-flight-${leg.id}`}><div className="flight-endpoints"><div><span className="endpoint-label"><span/>Departure</span><label className="field"><span>Airport code</span><AirportInput value={leg.departureAirport} onChange={value=>updateAirport(leg, 'departure', value)} placeholder="LAX"/><small>{findAirport(leg.departureAirport)?.name ?? 'Enter an IATA code (3 letters) or ICAO code (4)'}</small></label><label className="field"><span>Local departure date & time</span><input type="datetime-local" step={60} value={minuteDateTimeValue(leg.departureDateTime)} onChange={event => updateDeparture(leg, event.target.value)} required/></label><label className="field timezone-field"><span>Departure time zone</span><input list="time-zones" value={leg.departureTimeZone} onChange={event => updateLeg(leg.id, { departureTimeZone: event.target.value })} required/></label><FoldChoice local={leg.departureDateTime} zone={leg.departureTimeZone} value={leg.departureDisambiguation} onChange={value=>updateLeg(leg.id,{departureDisambiguation:value})} label="Departure"/></div>
          <div><span className="endpoint-label arrival"><span/>Arrival</span><label className="field"><span>Airport code</span><AirportInput value={leg.arrivalAirport} onChange={value=>updateAirport(leg, 'arrival', value)} placeholder="LHR"/><small>{findAirport(leg.arrivalAirport)?.name ?? 'Enter an IATA code (3 letters) or ICAO code (4)'}</small></label><label className="field"><span>Local arrival date & time</span><input type="datetime-local" step={60} value={minuteDateTimeValue(leg.arrivalDateTime)} onChange={event => updateArrival(leg, event.target.value)} required/></label><label className="field timezone-field"><span>Arrival time zone</span><input list="time-zones" value={leg.arrivalTimeZone} onChange={event => updateLeg(leg.id, { arrivalTimeZone: event.target.value })} required/></label><FoldChoice local={leg.arrivalDateTime} zone={leg.arrivalTimeZone} value={leg.arrivalDisambiguation} onChange={value=>updateLeg(leg.id,{arrivalDisambiguation:value})} label="Arrival"/></div></div>
        <details className="flight-operations"><summary>Taxi time and airborne times</summary><p className="small-copy">Bookings normally give gate times. Without airborne times, allow 30 minutes for taxi at each end, then protect the first 30 minutes after takeoff and last 60 before landing.</p><div className="field-grid"><label className="field"><span>Taxi-out allowance (minutes)</span><input type="number" min="0" max="180" value={leg.taxiOutMinutes??30} onChange={event=>updateLeg(leg.id,{taxiOutMinutes:Number(event.target.value)})}/></label><label className="field"><span>Taxi-in allowance (minutes)</span><input type="number" min="0" max="180" value={leg.taxiInMinutes??30} onChange={event=>updateLeg(leg.id,{taxiInMinutes:Number(event.target.value)})}/></label><label className="field"><span>Known takeoff time (departure local, optional)</span><input type="datetime-local" step={60} value={minuteDateTimeValue(leg.takeoffDateTime)} onChange={event=>updateLeg(leg.id,{takeoffDateTime:event.target.value||undefined})}/></label><label className="field"><span>Known landing time (arrival local, optional)</span><input type="datetime-local" step={60} value={minuteDateTimeValue(leg.landingDateTime)} onChange={event=>updateLeg(leg.id,{landingDateTime:event.target.value||undefined})}/></label></div></details></div>}
        <div className="cabin-editor field-grid"><label className="field"><span>Travel class</span><select value={leg.travelClass ?? 'economy'} onChange={event=>updateLeg(leg.id,{travelClass:event.target.value as FlightLeg['travelClass']})}><option value="economy">Economy</option><option value="premium-economy">Premium economy</option><option value="business">Business</option><option value="first">First</option></select></label><label className="field"><span>Lie-flat bed available?</span><select value={leg.lieFlat ? 'yes' : 'no'} onChange={event=>updateLeg(leg.id,{lieFlat:event.target.value==='yes'})}><option value="no">No / unsure — seated rest</option><option value="yes">Yes — confirmed lie-flat bed</option></select><small>Confirm your actual seat. Business class can have an upright or reclining seat.</small></label></div>
        <div className="flight-rest-note"><Moon size={15}/><p>Rest windows exclude the first 30 minutes after takeoff and the final 60 minutes before landing. Crew instructions and seatbelt requirements take priority.</p></div>
        <div className="stay-editor"><label className="field"><span>After this flight</span><select value={leg.stayAfter} onChange={event => updateLeg(leg.id, { stayAfter: event.target.value as FlightLeg['stayAfter'] })}><option value="destination">I’m staying at this destination</option><option value="connection">Airport connection / in transit</option></select></label>{leg.stayAfter === 'destination' ? <label className="field"><span>Adjustment strategy for this stay</span><select value={leg.strategy} onChange={event => updateLeg(leg.id, { strategy: event.target.value as FlightLeg['strategy'] })}><option value="adapt">Adjust toward local time</option><option value="partial">Partial adjustment for a short stay</option><option value="home">Keep my home rhythm</option></select><small>{leg.strategy === 'partial' ? 'Useful when you have a short stay before another destination.' : leg.strategy === 'home' ? 'Preserve your home body clock while planning in local time.' : 'Shift gradually toward your preferred destination sleep schedule.'}</small></label> : <div className="connection-info"><Info size={16}/><p>Your body-clock estimate continues through this connection. Add the onward flight below.</p></div>}</div>
      </section>)}</div>
      <button type="button" className="add-flight-button" onClick={addLeg}><Plus size={17}/>Add the next flight or return leg</button>
      <div className="inline-note"><Globe2 size={16}/><p>All flight times use each airport’s local time. Confirm the schedule against your booking before saving. Aircraft may change; confirm with the airline.</p></div>
      <div className="modal-footer sticky-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">{existing ? 'Save & regenerate plan' : 'Create my plan'}<ArrowRight size={16}/></button></div>
    </form>
  </Modal>;
}

function SelectedFlight({ leg, candidate }: { leg: FlightLeg; candidate?: FlightCandidate }) {
  let duration = candidate?.durationMinutes;
  if (duration === undefined) {
    try {
      duration = Math.round((localToInstant(leg.arrivalDateTime, leg.arrivalTimeZone, leg.arrivalDisambiguation) - localToInstant(leg.departureDateTime, leg.departureTimeZone, leg.departureDisambiguation)) / 60000);
    } catch { /* Ambiguous manual clocks are resolved in the manual editor. */ }
  }
  return <section className="flight-selection-summary" aria-label="Selected flight">
    <div className="flight-selection-route"><Plane size={18}/><strong>{leg.departureAirport} <ArrowRight size={15}/> {leg.arrivalAirport}</strong>{duration !== undefined && duration > 0 && <span>{Math.floor(duration / 60)}h {duration % 60}m</span>}</div>
    {candidate && <p className="flight-selection-airline">{candidate.airline}{candidate.operatingFlightNumber ? ` · operated as ${candidate.operatingFlightNumber}` : ''}</p>}
    <p className="flight-selection-aircraft">{aircraftLabel(leg.aircraft) ? `Aircraft · ${aircraftLabel(leg.aircraft)}` : 'Aircraft type not provided'}</p>
    <div className="flight-selection-clocks">{([
      { label: 'Departs', at: leg.departureDateTime, airport: leg.departureAirport, zone: leg.departureTimeZone },
      { label: 'Arrives', at: leg.arrivalDateTime, airport: leg.arrivalAirport, zone: leg.arrivalTimeZone },
    ]).map(clock => <div key={clock.label}><span>{clock.label} · {clock.airport}</span><strong><time dateTime={clock.at}>{minuteDateTimeValue(clock.at).replace('T', ' ')}</time></strong><small>{clock.zone}</small></div>)}</div>
    {leg.flightSource === 'aerodatabox' && <small className="flight-selection-source">Originally imported from AeroDataBox · check against your booking</small>}
  </section>;
}

