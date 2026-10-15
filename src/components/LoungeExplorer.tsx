import { useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { Armchair, ArrowUpRight, Check, Clock3, ExternalLink, ShowerHead, Sparkles, Utensils, Wifi } from 'lucide-react';
import type { Preferences, TravelClass } from '../lib/types';
import { LOUNGE_MEMBERSHIPS, type LoungeEvaluation, type LoungePriority } from '../lib/lounge-types';
import { LOUNGE_AIRLINES, LOUNGE_DATA, loungeDataFor } from '../lib/lounge-data';
import { evaluateAirportLounges } from '../lib/lounge-access';
import { airportCountry, type LoungeFlightContext } from '../lib/lounge-windows';
import { findAirport } from '../lib/airports';
import { localToInstant } from '../lib/time';
import { travelClock } from '../lib/travel-clocks';
import { AirportInput } from './AirportInput';
import { FoldChoice } from './FoldChoice';
import './lounge-memberships.css';

interface Props { preferences: Preferences; onPreferences: (preferences: Preferences) => void; opportunity?: LoungeFlightContext; onClearContext: () => void; onEditMemberships: () => void }
const iso = (value: number) => new Date(value).toISOString();
function localParts(value: string, zone: string) { const date = Temporal.Instant.from(value).toZonedDateTimeISO(zone); return { date: date.toPlainDate().toString(), time: date.toPlainTime().toString({ smallestUnit: 'minute' }) }; }
function foldFor(value: string | undefined, zone: string | undefined): 'earlier' | 'later' | undefined {
  if (!value || !zone) return undefined;
  const parts = localParts(value, zone), local = `${parts.date}T${parts.time}`;
  const earlier = localToInstant(local, zone, 'earlier'), later = localToInstant(local, zone, 'later');
  return earlier === later ? undefined : Date.parse(value) >= later ? 'later' : 'earlier';
}

export function LoungeExplorer({ preferences, onPreferences, opportunity, onClearContext, onEditMemberships }: Props) {
  const initial = opportunity ? localParts(opportunity.start ?? opportunity.departure, opportunity.timeZone) : { date: Temporal.Now.plainDateISO('America/Los_Angeles').toString(), time: '10:00' };
  const [airport, setAirport] = useState(opportunity?.airport ?? 'SFO');
  const [contextActive, setContextActive] = useState(Boolean(opportunity));
  const [date, setDate] = useState(initial.date);
  const [from, setFrom] = useState(opportunity && !opportunity.start ? '' : initial.time);
  const [until, setUntil] = useState(opportunity?.end ? localParts(opportunity.end, opportunity.timeZone).time : opportunity ? '' : '12:00');
  const [departureTime, setDepartureTime] = useState(opportunity ? localParts(opportunity.departure, opportunity.timeZone).time : '13:00');
  const [fromChoice, setFromChoice] = useState<'earlier' | 'later' | undefined>(() => foldFor(opportunity?.start, opportunity?.timeZone));
  const [untilChoice, setUntilChoice] = useState<'earlier' | 'later' | undefined>(() => foldFor(opportunity?.end, opportunity?.timeZone));
  const [departureChoice, setDepartureChoice] = useState<'earlier' | 'later' | undefined>(() => foldFor(opportunity?.departure, opportunity?.timeZone));
  const [operatingCarrier, setOperatingCarrier] = useState('');
  const prefix = opportunity?.flightNumber.replace(/\s/g, '').match(/^([A-Z0-9]{2})(?=\d)/)?.[1] ?? '';
  const [marketingCarrier, setMarketingCarrier] = useState<string>(LOUNGE_AIRLINES.some(([code]) => code === prefix) ? prefix : '');
  const [terminal, setTerminal] = useState('');
  const [cabin, setCabin] = useState<TravelClass>(opportunity?.travelClass ?? 'economy');
  const initialOriginCountry = airportCountry(opportunity?.airport ?? 'SFO'), initialDestinationCountry = airportCountry(opportunity?.destinationAirport ?? '');
  const [route, setRoute] = useState<'international' | 'domestic'>(initialOriginCountry && initialDestinationCountry && initialOriginCountry === initialDestinationCountry ? 'domestic' : 'international');
  const data = loungeDataFor(airport);
  const zone = data?.timeZone ?? findAirport(airport)?.timeZone;
  const memberships = preferences.loungeMemberships ?? [];
  const membershipLabels = LOUNGE_MEMBERSHIPS.filter(program => memberships.includes(program.id)).map(program => program.label);
  const priority = preferences.loungePriority ?? 'balanced';
  const terminals = [...new Set(data?.lounges.map(lounge => lounge.terminal) ?? [])];
  let error = '', start = '', end = '', departure = '';
  let endDate = date, departureDate = date;
  try {
    if (!zone || !date || !from || !until || !departureTime) throw new Error('Choose an airport and a complete visit time.');
    const day = Temporal.PlainDate.from(date), followingDay = day.add({ days: 1 }).toString();
    const originalEnd = contextActive && opportunity?.end ? localParts(opportunity.end, zone) : undefined;
    const originalDeparture = contextActive && opportunity ? localParts(opportunity.departure, zone) : undefined;
    endDate = originalEnd && date === initial.date && until === originalEnd.time ? originalEnd.date : until <= from ? followingDay : date;
    departureDate = originalDeparture && date === initial.date && departureTime === originalDeparture.time ? originalDeparture.date : departureTime < from ? followingDay : date;
    function resolve(local: string, choice: 'earlier' | 'later' | undefined, original?: string): string {
      if (contextActive && original) {
        const parts = localParts(original, zone!);
        if (`${parts.date}T${parts.time}` === local && choice === foldFor(original, zone)) return original;
      }
      return iso(localToInstant(local, zone!, choice));
    }
    start = resolve(`${date}T${from}`, fromChoice, opportunity?.start);
    end = resolve(`${endDate}T${until}`, untilChoice, opportunity?.end);
    departure = resolve(`${departureDate}T${departureTime}`, departureChoice, opportunity?.departure);
    const duration = Date.parse(end) - Date.parse(start);
    if (duration <= 0) throw new Error('Finish your visit after it starts. Check the date and any repeated clock times.');
    if (duration > 12 * 3_600_000) throw new Error('Choose a visit of 12 hours or less. An earlier end time means the following day.');
    if (Date.parse(end) > Date.parse(departure) - 30 * 60_000) throw new Error('Finish your lounge visit at least 30 minutes before departure.');
  } catch (cause) { error = cause instanceof Error ? cause.message : 'Choose valid airport-local times.'; }
  const recommendation = data && !error ? evaluateAirportLounges(data, {
    memberships, cabin, operatingCarrier: operatingCarrier || undefined, marketingCarrier: marketingCarrier || undefined,
    terminal: terminal || undefined, route,
    destinationCountry: contextActive && opportunity && airport === opportunity.airport ? airportCountry(opportunity.destinationAirport) : undefined,
    visitStart: start, visitEnd: end, departure, minimumVisitMinutes: 30, priority,
  }) : undefined;
  const total = data?.lounges.length ?? 0;
  function changeAirport(value: string) {
    const next = value.toUpperCase();
    if (next !== airport) {
      setContextActive(false); setTerminal(''); setOperatingCarrier(''); setMarketingCarrier('');
      setCabin('economy'); setRoute('international');
      setFromChoice(undefined); setUntilChoice(undefined); setDepartureChoice(undefined);
    }
    setAirport(next);
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow muted">A better connection</span><h1>Lounge Explorer</h1><p>Find a place to shower, eat or unwind before your flight.</p></div><span className="lounge-heading-icon"><Armchair size={29}/></span></div>
    {contextActive && opportunity && <div className="lounge-context"><div><strong>{opportunity.kind === 'transit' ? 'Your transit' : 'Before your flight'} · {opportunity.flightNumber || `${opportunity.airport} → ${opportunity.destinationAirport}`}</strong><p>{opportunity.note}</p></div><button type="button" className="text-button" onClick={onClearContext}>Explore another airport <ArrowUpRight size={14}/></button></div>}
    <div className="lounge-search-panel">
      <div className="lounge-fields">
        <label className="lounge-field">Airport<AirportInput value={airport} onChange={changeAirport} placeholder="SFO"/></label>
        <label className="lounge-field">Visit date<input type="date" value={date} onChange={event => { setDate(event.target.value); setFromChoice(undefined); setUntilChoice(undefined); setDepartureChoice(undefined); }} required/></label>
        <label className="lounge-field">From<input type="time" step="60" value={from} onChange={event => { setFrom(event.target.value); setFromChoice(undefined); }}/></label>
        <label className="lounge-field">Until<input type="time" step="60" value={until} onChange={event => { setUntil(event.target.value); setUntilChoice(undefined); }}/></label>
        <label className="lounge-field">Departure time<input type="time" step="60" value={departureTime} onChange={event => { setDepartureTime(event.target.value); setDepartureChoice(undefined); }}/></label>
      </div>
      <div className="lounge-folds">{zone && <><FoldChoice local={`${date}T${from}`} zone={zone} value={fromChoice} onChange={setFromChoice} label="Visit start"/><FoldChoice local={`${endDate}T${until}`} zone={zone} value={untilChoice} onChange={setUntilChoice} label="Visit end"/><FoldChoice local={`${departureDate}T${departureTime}`} zone={zone} value={departureChoice} onChange={setDepartureChoice} label="Flight departure"/></>}</div>
      <p className="lounge-time-note"><Clock3 size={13}/>{zone ? `All times at the airport · ${zone.replaceAll('_', ' ')}` : 'Choose an airport to set local time.'}{endDate > date && ` · Visit ends ${endDate}.`}{departureDate > date && ` · Departure ${departureDate}.`}</p>
      <details className="lounge-flight-details" open>
        <summary>Your departing flight</summary>
        <div className="lounge-fields flight-context-fields">
          <label className="lounge-field">Operating airline<select value={operatingCarrier} onChange={event => setOperatingCarrier(event.target.value)}><option value="">Confirm airline</option>{LOUNGE_AIRLINES.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>
          <label className="lounge-field">Marketing airline<select value={marketingCarrier} onChange={event => setMarketingCarrier(event.target.value)}><option value="">Not specified</option>{LOUNGE_AIRLINES.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>
          <label className="lounge-field">Cabin<select value={cabin} onChange={event => setCabin(event.target.value as TravelClass)}><option value="economy">Economy</option><option value="premium-economy">Premium economy</option><option value="business">Business</option><option value="first">First</option></select></label>
          <label className="lounge-field">Flight route<select value={route} onChange={event => setRoute(event.target.value as typeof route)}><option value="international">International</option><option value="domestic">Domestic</option></select></label>
          <label className="lounge-field">Departure terminal<select value={terminal} onChange={event => setTerminal(event.target.value)}><option value="">Check terminal access</option>{terminals.map(value => <option key={value}>{value}</option>)}</select></label>
        </div>
        <p className="lounge-time-note">For a codeshare, the operating airline flies the plane; the marketing airline is on the flight number.</p>
      </details>
    </div>
    <section className="lounge-preferences-row" aria-label="Lounge preferences">
      <div className="lounge-membership-summary"><p>{membershipLabels.length ? `Using ${membershipLabels.join(' · ')}` : 'No lounge memberships saved'}</p><button type="button" className="text-button" onClick={onEditMemberships}>Edit memberships <ArrowUpRight size={13}/></button></div>
      <label className="lounge-field lounge-priority">Prioritise<select value={priority} onChange={event => onPreferences({ ...preferences, loungePriority: event.target.value as LoungePriority })}><option value="balanced">A little of everything</option><option value="showers">A shower</option><option value="dining">A good meal</option><option value="quiet">A quiet space</option></select></label>
    </section>
    {!data ? <section className="empty-card lounge-empty"><Armchair size={30}/><h2>{findAirport(airport)?.city ?? (airport || 'Choose an airport')}</h2><p>We haven’t researched lounges here yet. Current coverage: {LOUNGE_DATA.map(value => value.airport).join(', ')}.</p></section> : error ? <p className="alert" role={!from || !until ? 'status' : 'alert'}>{!from || !until ? 'Set your visit times to check lounge access and opening hours.' : error}</p> : <>
      <div className="lounge-results-heading"><div><h2>{findAirport(airport)?.city ?? airport} lounges</h2><p>{total} researched lounges · reviewed {data.updatedAt}</p></div><span className="lounge-count">{recommendation?.results.filter(value => value.access === 'eligible' && value.opening === 'open' && value.visit && value.visit.minutes >= 30).length ?? 0} match this visit</span></div>
      {!recommendation?.recommendedId && <p className="lounge-recommendation-note">{!operatingCarrier || !terminal ? 'Confirm your operating airline and terminal to narrow down a recommendation.' : 'No confirmed match fits this visit. Check the conditional options below.'}</p>}
      <div className="lounge-results">{recommendation?.results.map(result => <LoungeCard key={result.lounge.id} result={result} timeZone={data.timeZone}/>)}</div>
    </>}
    <p className="lounge-coverage-note">A curated starting guide, not a complete airport directory. Access is for the member; guest entitlements, capacity and paid extras follow the linked program’s rules. Spa and restaurant privileges can differ from lounge entry.</p>
  </>;
}

function LoungeCard({ result, timeZone }: { result: LoungeEvaluation; timeZone: string }) {
  const { lounge, access, opening } = result;
  const photo = lounge.photos[0];
  const visit = result.visit;
  const from = visit ? travelClock(visit.start, timeZone) : undefined, until = visit ? travelClock(visit.end, timeZone) : undefined;
  const amenities = [
    { show: lounge.amenities.showers === 'yes', label: 'Showers', icon: ShowerHead },
    { show: lounge.amenities.dining !== 'none' && lounge.amenities.dining !== 'unknown', label: lounge.amenities.dining === 'restaurant' ? 'Restaurant' : lounge.amenities.dining === 'buffet' ? 'Food & drinks' : 'Snacks', icon: Utensils },
    { show: lounge.amenities.spa === 'yes', label: 'Spa', icon: Sparkles },
    { show: lounge.amenities.quietArea === 'yes', label: 'Quiet area', icon: Armchair },
    { show: lounge.amenities.wifi === 'yes', label: 'Wi-Fi', icon: Wifi },
  ];
  const selectedRule = lounge.accessRules.find(rule => rule.id === result.selectedRuleId);
  const extraFee = selectedRule?.additionalFee;
  return <article className={`lounge-card${result.recommended ? ' recommended' : ''}${lounge.status === 'temporarily-closed' ? ' lounge-closed' : ''}`} data-lounge-id={lounge.id}>
    {photo && <figure className="lounge-photo"><img src={photo.path} alt={photo.alt} loading="lazy"/><figcaption><a href={photo.sourceUrl} target="_blank" rel="noreferrer">{photo.credit} · {photo.license}</a></figcaption></figure>}
    <div className="lounge-card-content">
      <header><div className="lounge-card-symbol"><Armchair size={23}/></div><div>{result.recommended && <span className="lounge-recommended"><Sparkles size={12}/>Recommended</span>}<h3>{lounge.name}</h3><p>{lounge.terminal} · {lounge.airside ? 'After security' : 'Before security'}</p></div></header>
      <div className="lounge-badges"><span className={`lounge-access ${access}`}>{access === 'eligible' ? <Check size={13}/> : null}{access === 'eligible' ? 'Access matches' : access === 'conditional' ? 'Check access' : 'No matching access'}</span><span className={`lounge-opening ${opening}`}>{lounge.status === 'temporarily-closed' ? 'Temporarily closed' : opening === 'open' ? 'Open during your visit' : opening === 'closed' ? 'Closed during your visit' : 'Hours need checking'}</span></div>
      {from && until && <p className="lounge-visit"><Clock3 size={14}/>{from.time}–{until.time}{from.dateKey !== until.dateKey ? `, ${until.date}` : ''} · {Math.floor(visit!.minutes)} min available</p>}
      <div className="lounge-amenities">{amenities.filter(amenity => amenity.show).map(({ label, icon: Icon }) => <span key={label}><Icon size={14}/>{label}</span>)}</div>
      {result.recommended && !lounge.recommendation && <p className="lounge-choice-reason">{result.recommendationReason}</p>}
      {(lounge.recommendation?.summary ?? lounge.note) && <p className="lounge-card-note">{lounge.recommendation?.summary ?? lounge.note}</p>}
      {extraFee && access !== 'ineligible' && <p className="lounge-extra-fee">Additional entry fee: {new Intl.NumberFormat('en', { style: 'currency', currency: extraFee.currency, currencyDisplay: 'code', maximumFractionDigits: 2 }).format(extraFee.amount)}</p>}
      <details className="lounge-access-details"><summary>Access & sources</summary><p>{lounge.location}</p>
        {lounge.recommendation && lounge.note && <p>{lounge.note}</p>}
        <ul>{[...new Set([...result.reasons, ...result.warnings])].map(reason => <li key={reason}>{reason}</li>)}</ul>
        {lounge.hours.note && <p>{lounge.hours.note}</p>}
        <div className="lounge-sources">{lounge.sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={12}/></a>)}</div>
        {lounge.photos.length > 1 && <div className="lounge-gallery" aria-label="More lounge photos">{lounge.photos.slice(1).map(photo => <figure className="lounge-photo" key={photo.path}><a href={photo.path} target="_blank" rel="noreferrer"><img src={photo.path} alt={photo.alt} loading="lazy"/></a><figcaption><a href={photo.sourceUrl} target="_blank" rel="noreferrer">{photo.credit} · {photo.license}</a></figcaption></figure>)}</div>}
        <small>Sources checked {lounge.sources.map(source => source.checkedOn).sort().at(0)}. Amenity availability and extra charges can change.</small>
      </details>
    </div>
  </article>;
}
