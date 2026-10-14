import { useEffect, useRef, useState } from 'react';
import type { FlightCandidate, FlightLeg, FlightLookupResult } from '../lib/types';
import { lookupFlight } from '../lib/auth';

export function FlightLookup({leg,accountId,available,onApply}:{leg:FlightLeg;accountId:string|null;available:boolean;onApply:(patch:Partial<FlightLeg>)=>void}) {
  const [date,setDate]=useState(leg.departureDateTime.slice(0,10));
  const [result,setResult]=useState<FlightLookupResult|null>(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [confirmed,setConfirmed]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const query=useRef(0);
  useEffect(()=>()=>{query.current++;controller.current?.abort();},[]);
  useEffect(()=>{const departureDate=leg.departureDateTime.slice(0,10);if(departureDate)setDate(departureDate);},[leg.departureDateTime]);
  useEffect(()=>{query.current++;controller.current?.abort();setResult(null);setError('');setBusy(false);setConfirmed(false);},[leg.flightNumber,leg.departureAirport,accountId,date]);
  async function lookup() {
    if(!accountId)return;
    controller.current?.abort();controller.current=new AbortController();const version=++query.current;
    setBusy(true);setError('');setResult(null);
    try {const data=await lookupFlight(accountId,leg.flightNumber,date,leg.departureAirport||undefined,controller.current.signal);if(query.current===version)setResult(data);}
    catch(e){if(query.current===version)setError(e instanceof Error?e.message:'Flight lookup is unavailable. Enter your booking manually.');}
    finally{if(query.current===version)setBusy(false);}
  }
  function apply(candidate:FlightCandidate) {
    if(!confirmed || !result)return;
    onApply({departureDisambiguation:undefined,arrivalDisambiguation:undefined,takeoffDateTime:undefined,landingDateTime:undefined,flightNumber:candidate.flightNumber,departureAirport:candidate.departureAirport,arrivalAirport:candidate.arrivalAirport,
      departureDateTime:candidate.departureDateTime,arrivalDateTime:candidate.arrivalDateTime,departureTimeZone:candidate.departureTimeZone,arrivalTimeZone:candidate.arrivalTimeZone,
      ...(candidate.departureDisambiguation?{departureDisambiguation:candidate.departureDisambiguation}:{}),...(candidate.arrivalDisambiguation?{arrivalDisambiguation:candidate.arrivalDisambiguation}:{}),
      ...(candidate.takeoffDateTime?{takeoffDateTime:candidate.takeoffDateTime}:{}),...(candidate.landingDateTime?{landingDateTime:candidate.landingDateTime}:{}),
      flightSource:'aerodatabox',flightFetchedAt:result.fetchedAt,providerRecordConfirmed:true});
  }
  return <details className="flight-lookup"><summary>Find this flight by number and departure date</summary><p className="small-copy">Schedules are best effort. Check your booking before saving; your cabin and bed choices stay yours.</p>
    {!available || !accountId?<p className="small-copy">{!accountId?'Sign in with Google to use flight lookup. Manual entry is always available.':'Flight lookup needs an AeroDataBox API key configured for this app.'}</p>:<>
      <label className="field"><span>Departure date at the departure airport</span><input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label>
      <button type="button" className="button secondary" disabled={busy||!date||!leg.flightNumber.trim()} onClick={()=>void lookup()}>{busy?'Looking up flight…':'Look up flight'}</button>
      {busy&&<button type="button" className="text-button" onClick={()=>{query.current++;controller.current?.abort();setBusy(false);}}>Cancel lookup</button>}
      {error&&<p role="alert" className="inline-error">{error}</p>}
      {result&&<div className="flight-results"><p>{result.stale?'Stale cached schedule · check your booking':'Schedule retrieved'} · {new Date(result.fetchedAt).toLocaleString()}</p>{result.warnings.map((warning,i)=><p className="small-copy" key={i}>{warning}</p>)}
        {!result.candidates.length?<p>No matching flight found. Enter your booking manually or try an operating flight number.</p>:<><label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>This is my own booked or previously traveled trip. I will verify the schedule against my booking.</span></label>{result.candidates.map(candidate=><article className="flight-result" key={candidate.id}><strong>{candidate.flightNumber} · {candidate.airline}</strong><span>{candidate.departureAirport} → {candidate.arrivalAirport} · {Math.floor(candidate.durationMinutes/60)}h {candidate.durationMinutes%60}m</span><span>Departs {candidate.departureDateTime.replace('T',' ')} ({candidate.departureTimeZone})</span><span>Arrives {candidate.arrivalDateTime.replace('T',' ')} ({candidate.arrivalTimeZone})</span>{candidate.operatingFlightNumber&&<span>Operated as {candidate.operatingFlightNumber}</span>}<button type="button" className="button secondary" disabled={!confirmed} onClick={()=>apply(candidate)}>Use this flight</button></article>)}</>}
        <a href="https://aerodatabox.com/" target="_blank" rel="noopener">Flight data by AeroDataBox</a></div>}
    </>}
  </details>;
}
