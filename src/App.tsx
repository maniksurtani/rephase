import { useEffect, useId, useRef, useState } from 'react';
import type { AppData, Account, AdherenceRecord, PlanAction, PlanTravelSegment, Preferences, Trip } from './lib/types';
import { validateTrip } from './lib/plan';
import { findAirport } from './lib/airports';
import { createEmptyTrip } from './lib/defaults';
import { exportCalendar, exportData } from './lib/export';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Coffee, Download, ExternalLink, EyeOff, Globe2, Info, LoaderCircle, LogOut, Moon, Pencil, Plane, Plus, ShieldCheck, Sparkles, Sun, Trash2, UserRound, X } from 'lucide-react';
import './styles.css';
import { usePlanning } from './lib/usePlanning';
import type { AuthConfig } from './lib/auth';
import { TripEditor } from './components/TripEditor';
import { Modal } from './components/Modal';
import { FlightSegmentCard } from './components/FlightSegmentCard';
import { actionTravelSegment, travelClock } from './lib/travel-clocks';
import { groupPlanDays, isCalendarDayCurrent } from './lib/plan-calendar';
import { AdherenceForm } from './components/AdherenceForm';
import { validateAppData } from './lib/validation';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { aircraftLabel } from './lib/aircraft';

export interface AppProps {
  data: AppData;
  onChange: (data: AppData) => void;
  account: Account | null;
  authConfig: AuthConfig;
  saveStatus: string;
  accountReady: boolean;
  onGoogleSignIn: (account: Account) => void;
  onSignInError: (error: Error) => void;
  onSignOut: () => Promise<void>;
  onDeleteAccountData: () => Promise<void>;
  onClearLocal: () => Promise<void>;
  storageError: string | null;
}

type Tab = 'today' | 'plan' | 'trips' | 'profile';
const tabs: { id: Tab; label: string; icon: typeof Sun }[] = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'plan', label: 'Your plan', icon: CalendarDays },
  { id: 'trips', label: 'Trips', icon: Plane },
  { id: 'profile', label: 'Profile', icon: UserRound },
];
const actionMeta: Record<PlanAction['type'], { icon: typeof Sun; label: string; color: string }> = {
  sleep: { icon: Moon, label: 'Sleep', color: 'sleep' },
  light: { icon: Sun, label: 'Seek light', color: 'light' },
  'avoid-light': { icon: EyeOff, label: 'Avoid bright light', color: 'shade' },
  caffeine: { icon: Coffee, label: 'Caffeine window', color: 'caffeine' },
  melatonin: { icon: Sparkles, label: 'Optional melatonin', color: 'melatonin' },
};
const commonZones = ['America/Los_Angeles', 'America/New_York', 'America/Chicago', 'America/Toronto', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'];

function time(iso: string, zone: string) {
  try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(new Date(iso)); } catch { return '—'; }
}
function dateLabel(date: string, style: 'long' | 'short' = 'short') {
  try { return new Intl.DateTimeFormat('en-GB', { weekday: style === 'long' ? 'long' : 'short', day: 'numeric', month: style === 'long' ? 'long' : 'short', timeZone: 'UTC' }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`)); } catch { return date; }
}
function localDate(iso: string | Date, zone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).formatToParts(new Date(iso));
    return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`;
  } catch { return ''; }
}
function zoneName(zone: string, at?: string) {
  try { return new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'short' }).formatToParts(at ? new Date(at) : new Date()).find(p => p.type === 'timeZoneName')?.value ?? zone; } catch { return zone; }
}
function city(zone: string) { return zone.split('/').at(-1)?.replaceAll('_', ' ') ?? zone; }
function airportCity(code: string) { return findAirport(code)?.city ?? code; }
function plural(value: number, text: string) { return `${value} ${text}${value === 1 ? '' : 's'}`; }
function phaseChangeLabel(hours: number) {
  if (!Number.isFinite(hours)) return 'Unavailable';
  if (hours === 0) return 'Nearly steady';
  const minutes = Math.abs(hours) * 60;
  const amount = minutes < 5 ? 'Under 5 min' : minutes < 60 ? `About ${Math.round(minutes / 5) * 5} min` : `About ${Math.round(Math.abs(hours) * 10) / 10} h`;
  return `${amount} ${hours > 0 ? 'earlier' : 'later'}`;
}
function sleepSpan(bed: string, wake: string) {
  const toMins = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
  return ((toMins(wake) - toMins(bed) + 1440) % 1440) / 60;
}
function MoonScene() {
  return <svg className="moon-scene" viewBox="0 0 510 290" aria-hidden="true">
    <defs><radialGradient id="moon-glow"><stop stopColor="#bda6ef" stopOpacity=".19"/><stop offset="1" stopColor="#bda6ef" stopOpacity="0"/></radialGradient><linearGradient id="moon-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e3d8f9"/><stop offset="1" stopColor="#8071a9"/></linearGradient><mask id="crescent-mask"><rect width="510" height="290" fill="white"/><circle cx="302" cy="98" r="62" fill="black"/></mask></defs>
    <circle cx="275" cy="140" r="130" fill="url(#moon-glow)"/>
    <ellipse cx="268" cy="154" rx="173" ry="61" fill="none" stroke="#b6a2e7" strokeOpacity=".14" transform="rotate(-24 268 154)"/>
    <ellipse cx="268" cy="154" rx="208" ry="84" fill="none" stroke="#b6a2e7" strokeOpacity=".07" transform="rotate(-24 268 154)"/>
    <circle cx="270" cy="130" r="68" fill="url(#moon-fill)" mask="url(#crescent-mask)"/>
    <circle cx="401" cy="94" r="4" fill="#e9b985"/><circle cx="111" cy="205" r="3" fill="#c7b6ee"/><circle cx="367" cy="220" r="2" fill="#c7b6ee"/>
    <path d="M153 70v8m-4-4h8M405 165v10m-5-5h10M340 45v6m-3-3h6" stroke="#d9c9f5" strokeOpacity=".6" strokeLinecap="round"/>
    <circle cx="110" cy="118" r="1.5" fill="#ab98cd"/><circle cx="194" cy="247" r="1.5" fill="#ab98cd"/><circle cx="435" cy="245" r="1.5" fill="#ab98cd"/>
    <path d="m115 206 23-13 5 6-17 9-9 11-5-3 4-9-10-3 3-4Z" fill="#c9bce6" transform="rotate(13 126 207)"/>
  </svg>;
}

function ActionTravelClocks({ action, segment }: { action: PlanAction; segment: PlanTravelSegment }) {
  return <div className="travel-action-clocks" aria-label="Recommendation in origin and destination time">
    {[{ role: 'Origin', airport: segment.departureAirport, zone: segment.departureTimeZone }, { role: 'Destination', airport: segment.arrivalAirport, zone: segment.arrivalTimeZone }].map(clock => {
      const start = travelClock(action.start, clock.zone), end = travelClock(action.end, clock.zone);
      return <div className="travel-action-clock" key={clock.role}>
        <span>{clock.role} · {clock.airport}</span>
        <strong><time dateTime={action.start}>{start.date} {start.time}</time> – <time dateTime={action.end}>{end.date} {end.time}</time></strong>
        <small>{start.zone}{start.zone !== end.zone ? ` → ${end.zone}` : ''}</small>
      </div>;
    })}
  </div>;
}

function ActionCard({ action, compact = false, isCurrent = false, record, onRecord, travelSegments }: { travelSegments?: PlanTravelSegment[]; action: PlanAction; compact?: boolean; isCurrent?: boolean; record?: AdherenceRecord; onRecord?: (action:PlanAction)=>void }) {
  const [expanded, setExpanded] = useState(false);
  const segment = actionTravelSegment(action, travelSegments);
  const meta = actionMeta[action.type];
  const Icon = meta.icon;
  const differentDay = localDate(action.start, action.timeZone) !== localDate(action.end, action.timeZone);
  return <article className={`action-card ${meta.color} ${compact ? 'compact' : ''} ${isCurrent ? 'current' : ''}`}>
    <div className="action-time"><strong>{time(action.start, action.timeZone)}</strong><span>{time(action.end, action.timeZone)}{differentDay && <small> +1 day</small>}</span>{segment && <small>{zoneName(action.timeZone, action.start)}</small>}</div>
    <div className="action-symbol"><Icon size={20}/></div>
    <div className="action-content"><div className="action-title-line"><h3>{action.title}</h3>{isCurrent && <span className="live-label">Now</span>}</div><p>{action.detail}</p>{action.feasibility && <span className="feasibility-label">{action.feasibility === 'daylight' ? 'Daylight available' : action.feasibility === 'indoor' ? 'Indoor light needed' : 'Daylight uncertain'}</span>}{action.dose && <span className="dose-label">Informational dose range: {action.dose}</span>}
      {segment && <ActionTravelClocks action={action} segment={segment}/>}
      {!compact && <button type="button" className="why-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><Info size={13}/>{expanded ? 'Hide explanation' : 'Why this helps'}<ChevronRight size={13} className={expanded ? 'rotated' : ''}/></button>}
      {onRecord && <button type="button" className="why-button record-button" disabled={Date.parse(action.start)>Date.now()} onClick={()=>onRecord(action)}>{record ? `Recorded: ${record.status} · edit` : 'Record what happened'}</button>}
      {expanded && <div className="action-explanation"><p>{action.reason}</p>{action.evidenceUrl && <a href={action.evidenceUrl} target="_blank" rel="noreferrer">Read the source <ExternalLink size={12}/></a>}</div>}
    </div>
  </article>;
}

export default function App(props: AppProps) {
  const { data, onChange, account, authConfig, saveStatus, storageError } = props;
  const [tab, setTab] = useState<Tab>('today');
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [scienceOpen, setScienceOpen] = useState(false);
  const [draftTrip, setDraftTrip] = useState<Trip | null>(null);
  const draftAccountId = useRef<string | null>(account?.id ?? null);
  const [tripErrors, setTripErrors] = useState<string[]>([]);
  const [deleteTripId, setDeleteTripId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const trip = data.trips.find(t => t.id === data.selectedTripId) ?? data.trips[0] ?? null;
  const result = usePlanning(trip, data.preferences);
  const [recordAction,setRecordAction] = useState<PlanAction|null>(null);
  const plan = result.plan;
  const calendarDays = groupPlanDays(plan?.days ?? []);
  const isDemo = trip?.id.startsWith('demo-') ?? false;
  const allActions = calendarDays.flatMap(day => day.actions).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)) ?? [];
  const currentAction = allActions.find(a => Date.parse(a.start) <= now.getTime() && Date.parse(a.end) > now.getTime());
  const nextAction = allActions.find(a => Date.parse(a.start) > now.getTime());
  const flights = [...new Map(calendarDays.flatMap(day => (day.travelSegments ?? []).map(segment => [segment.id, segment] as const))).values()].sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure));
  const currentFlight = flights.find(flight => Date.parse(flight.departure) <= now.getTime() && Date.parse(flight.arrival) > now.getTime());
  const nextFlight = flights.find(flight => Date.parse(flight.departure) > now.getTime());
  const flightDay = (flight: PlanTravelSegment) => {
    const date = currentFlight?.id === flight.id ? localDate(now, flight.arrivalTimeZone) : localDate(flight.departure, flight.departureTimeZone);
    return calendarDays.find(day => day.date === date && day.travelSegments.some(segment => segment.id === flight.id)) ?? calendarDays.find(day => day.travelSegments.some(segment => segment.id === flight.id));
  };
  const currentDay = calendarDays.find(day => day.actions.some(action => action.id === currentAction?.id)) ?? (currentFlight ? flightDay(currentFlight) : undefined);
  const nextDay = nextFlight && (!nextAction || Date.parse(nextFlight.departure) < Date.parse(nextAction.start)) ? flightDay(nextFlight) : calendarDays.find(day => day.actions.some(action => action.id === nextAction?.id));
  const today = currentDay ?? (nextDay && isCalendarDayCurrent(nextDay, now.getTime()) ? nextDay : calendarDays.filter(day => isCalendarDayCurrent(day, now.getTime())).at(-1));
  const upcomingDay = currentDay ?? nextDay;
  const defaultDay = today ?? upcomingDay ?? calendarDays[0];
  const selectedDay = calendarDays.find(day => day.id === selectedDayId) ?? defaultDay;
  const timelineDay = today ?? upcomingDay;
  const itineraryFinished = Boolean(calendarDays.length && !upcomingDay);
  const showSaveStatus = Boolean(saveStatus && !['Saved on this device', 'Saving on this device…', 'Opening your device data…', 'Device data cleared'].includes(saveStatus));

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    // An editor opened for one identity must not save into a different account.
    setDraftTrip(null); setTripErrors([]); setDeleteTripId(null); setRecordAction(null); setSelectedDayId(null);
  }, [account?.id]);
  useEffect(() => { setSelectedDayId(null); }, [trip?.id]);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(null), 4500); return () => window.clearTimeout(timer); } }, [notice]);
  useEffect(() => {
    const open = scienceOpen || Boolean(draftTrip) || Boolean(deleteTripId);
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [scienceOpen, draftTrip, deleteTripId]);

  function editTrip(value: Trip) { draftAccountId.current = account?.id ?? null; setDraftTrip({ ...value, legs: value.legs.map(l => ({ ...l })) }); setTripErrors([]); }
  function createTrip() { draftAccountId.current = account?.id ?? null; setDraftTrip(createEmptyTrip()); setTripErrors([]); }
  function selectTrip(id: string) { onChange({ ...data, selectedTripId: id }); setSelectedDayId(null); }
  function saveTrip() {
    if (!draftTrip) return;
    if (draftAccountId.current !== (account?.id ?? null)) { setDraftTrip(null); return; }
    const errors = validateTrip(draftTrip);
    if (!draftTrip.name.trim()) errors.unshift('Give your trip a name.');
    if (errors.length) { setTripErrors(errors); return; }
    const saved = { ...draftTrip, id: draftTrip.id.startsWith('demo-') ? crypto.randomUUID() : draftTrip.id, name: draftTrip.name.trim(), updatedAt: new Date().toISOString() };
    if(saved.adherence)saved.adherence=saved.adherence.map(entry=>({...entry,tripId:saved.id}));
    const candidate={ ...data, trips: data.trips.some(t => t.id === draftTrip.id) ? data.trips.map(t => t.id === draftTrip.id ? saved : t) : [...data.trips, saved], selectedTripId: saved.id };
    const formatError=validateAppData(candidate);
    if(formatError){setTripErrors([formatError]);return;}
    onChange(candidate);
    setDraftTrip(null); setTab('plan'); setNotice('Trip saved. Your full itinerary plan is ready.');
  }
  function saveRecord(record:AdherenceRecord) {
    if(!trip)return;
    const updated={...trip,adherence:[...(trip.adherence??[]).filter(entry=>entry.actionId!==record.actionId),record],updatedAt:new Date().toISOString()};
    onChange({...data,trips:data.trips.map(value=>value.id===trip.id?updated:value)});setRecordAction(null);setNotice('Record saved. Future recommendations are being updated.');
  }
  function removeTrip() {
    const remaining = data.trips.filter(t => t.id !== deleteTripId);
    onChange({ ...data, trips: remaining, selectedTripId: data.selectedTripId === deleteTripId ? remaining[0]?.id ?? null : data.selectedTripId });
    setDeleteTripId(null); setNotice('Trip deleted.');
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <a href="#" className="brand" onClick={event => { event.preventDefault(); setTab('today'); }} aria-label="Rephase home"><span className="brand-mark"><Moon size={21}/></span><span>rephase<span className="brand-dot">.</span></span></a>
      <p className="sidebar-caption">Find your travel rhythm</p>
      <nav className="main-navigation" aria-label="Main navigation">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={`nav-item ${tab === id ? 'active' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={20}/><span>{label}</span>{tab === id && <span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="science-teaser"><div className="science-orbit"><Sparkles size={18}/></div><p>A little science.<br/>A better arrival.</p><button type="button" onClick={() => setScienceOpen(true)}>The science behind Rephase <ArrowUpRight size={14}/></button></div>
        <button type="button" className="account-shortcut" onClick={() => setTab('profile')}><span className="avatar"><AccountAvatar account={account}/></span><span><strong>{account?.name ?? 'Your profile'}</strong><small>{account ? 'Sleep preferences' : 'Saved on this device'}</small></span><ChevronRight size={16}/></button>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="mobile-brand"><Moon size={21}/><span>rephase.</span></div><span className="topbar-label">{tab === 'today' ? 'Your rhythm, wherever you go' : tabs.find(t => t.id === tab)?.label}</span><div className="topbar-actions"><button type="button" className="icon-button" aria-label="Learn about the science" onClick={() => setScienceOpen(true)}><Info size={19}/></button><AccountMenu account={account} accountReady={props.accountReady} clientId={authConfig.googleClientId} onProfile={() => setTab('profile')} onGoogleSignIn={props.onGoogleSignIn} onSignInError={props.onSignInError} onSignOut={props.onSignOut}/></div></header>
      <main id="main-content" className={`main-content page-${tab}`} tabIndex={-1}>
        {storageError && <div className="alert error-alert" role="alert"><Info size={17}/><span>{storageError}</span></div>}
        {showSaveStatus && <div className="account-save-status" role="status">{saveStatus}</div>}
        {result.loading && <div className="alert" role="status"><LoaderCircle size={17} className="spin"/><span>Finding a practical light and sleep plan for your whole journey…</span></div>}
        {result.error && <div className="alert error-alert"><Info size={17}/><span>{result.error}</span>{trip && <button type="button" onClick={() => editTrip(trip)}>Edit trip</button>}</div>}
        {tab === 'today' && <>
          <section className="welcome-hero"><div className="hero-copy"><span className="eyebrow"><span className="small-line"/>A softer landing</span><h1>New time zone.<br/><span>Same you.</span></h1><p>Your personal light, sleep, and travel plan.<br className="desktop-break"/> Arrive with your body clock a little more on your side.</p><button type="button" className="button primary hero-button" onClick={() => trip ? setTab('plan') : createTrip()}>{trip ? 'Explore your plan' : 'Plan your first trip'}<ArrowRight size={17}/></button></div><MoonScene/></section>
          <div className="dashboard-grid"><div className="dashboard-main">
            <div className="section-heading"><div><span className="eyebrow muted">Your next adventure</span><h2>{trip?.name ?? 'Where are you headed?'}</h2></div>{isDemo && <span className="pill demo-pill">Example trip</span>}</div>
            {trip ? <section className="trip-summary-card"><div className="trip-route">{trip.legs.slice(0, 5).map((leg, i) => <div className="route-segment" key={leg.id}>{i === 0 && <><div className="route-point"><span className="route-airport">{leg.departureAirport}</span><span>{airportCity(leg.departureAirport)}</span></div><div className="route-connector"><span/><Plane size={15}/><span/></div></>}<div className="route-point"><span className="route-airport">{leg.arrivalAirport}</span><span>{airportCity(leg.arrivalAirport)}</span>{leg.stayAfter === 'connection' && <small>Connection</small>}</div>{i < Math.min(trip.legs.length, 5) - 1 && <div className="route-connector"><span/><Plane size={15}/><span/></div>}</div>)}{trip.legs.length > 5 && <span className="more-stops">+{trip.legs.length - 5}</span>}</div><div className="trip-summary-footer"><span><CalendarDays size={15}/>{dateLabel(trip.legs[0]?.departureDateTime ?? '')}{trip.legs.length > 1 && ` – ${dateLabel(trip.legs.at(-1)?.arrivalDateTime ?? '')}`}</span><button type="button" className="text-button" onClick={() => setTab('trips')}>Trip details <ArrowUpRight size={15}/></button></div></section> : <section className="empty-card"><Plane size={28}/><h3>Start with your flights</h3><p>Add each stop, and we’ll connect the whole journey into one plan.</p><button type="button" className="button primary" onClick={createTrip}><Plus size={16}/>Add a trip</button></section>}
            {plan && <section className="today-section"><div className="section-heading"><div><span className="eyebrow muted">{today ? 'Your daily rhythm' : itineraryFinished ? 'Your journey' : 'A little preparation goes a long way'}</span><h2>{today ? 'Today, at a glance' : itineraryFinished ? 'This plan is complete' : 'Your first steps'}</h2></div>{timelineDay && <span className="subtle-label">{dateLabel(timelineDay.date)}</span>}</div>
              {isDemo && <div className="demo-note"><Info size={16}/><p>This is a sample itinerary. Add your flights and sleep preferences for a personal plan.</p><button type="button" onClick={createTrip}>Make it yours <ArrowRight size={14}/></button></div>}
              {!today && timelineDay && <div className="upcoming-note"><CalendarDays size={17}/><span>Your {timelineDay.stage === 'preparation' ? 'preparation' : 'next plan day'} begins <strong>{dateLabel(timelineDay.date, 'long')}</strong>. {timelineDay.travelSegments?.length ? 'Flight and recommendation times include both origin and destination clocks.' : `Times below are in ${city(timelineDay.timeZone)} (${zoneName(timelineDay.timeZone, timelineDay.actions[0]?.start)}).`}</span></div>}
              {today && <p className="timezone-caption"><Globe2 size={14}/>{today.travelSegments.length ? 'Travel day · both airport clocks below' : `${city(today.timeZone)} local time · ${zoneName(today.timeZone, today.actions[0]?.start)}`}</p>}
              {timelineDay?.travelSegments?.length ? <div className="day-flights">{timelineDay.travelSegments.map(segment => <FlightSegmentCard key={segment.id} segment={segment}/>)}</div> : null}
              {timelineDay && <div className="action-list">{timelineDay.actions.slice(0, 3).map(action => <ActionCard key={action.id} action={action} compact travelSegments={timelineDay.travelSegments} isCurrent={!isDemo && action.id === currentAction?.id}/>)}</div>}
              {itineraryFinished && <div className="empty-card subtle"><CheckCircle2 size={28}/><p>Your saved itinerary has ended. Create your next trip whenever you’re ready.</p></div>}
              <button type="button" className="button quiet full-plan-button" onClick={() => setTab('plan')}>See the full timeline <ArrowRight size={16}/></button>
            </section>}
          </div><aside className="insight-rail">
            <section className="next-action-card"><span className="eyebrow muted"><Clock3 size={14}/>{currentAction && !isDemo ? 'Happening now' : 'Next in your rhythm'}</span>{(currentAction && !isDemo ? currentAction : nextAction) ? <><div className={`next-action-icon ${actionMeta[(currentAction && !isDemo ? currentAction : nextAction)!.type].color}`}>{(() => { const Icon = actionMeta[(currentAction && !isDemo ? currentAction : nextAction)!.type].icon; return <Icon size={27}/>; })()}</div><h3>{(currentAction && !isDemo ? currentAction : nextAction)!.title}</h3><p>{(currentAction && !isDemo ? currentAction : nextAction)!.detail}</p><div className="next-action-time"><strong>{time((currentAction && !isDemo ? currentAction : nextAction)!.start, (currentAction && !isDemo ? currentAction : nextAction)!.timeZone)}</strong><span>{dateLabel(localDate((currentAction && !isDemo ? currentAction : nextAction)!.start, (currentAction && !isDemo ? currentAction : nextAction)!.timeZone))} · {city((currentAction && !isDemo ? currentAction : nextAction)!.timeZone)}</span></div>{isDemo && <span className="sample-caption">Preview from the example itinerary</span>}</> : <><div className="next-action-icon sleep"><Moon size={27}/></div><h3>Your rhythm starts here</h3><p>Add an upcoming trip to see your next action.</p></>}</section>
            <section className="profile-snapshot"><span className="eyebrow muted">Built around you</span><h3>Your everyday rhythm</h3><div className="sleep-clock"><span><Moon size={16}/><strong>{data.preferences.usualBedtime}</strong><small>Usual bedtime</small></span><span className="sleep-clock-divider"/><span><Sun size={16}/><strong>{data.preferences.usualWakeTime}</strong><small>Usual wake time</small></span></div><div className="profile-facts"><span>{data.preferences.sleepHours} hours of sleep</span><span>{data.preferences.chronotype === 'unsure' ? 'Chronotype: unsure' : `${data.preferences.chronotype[0].toUpperCase()}${data.preferences.chronotype.slice(1)} chronotype`}</span></div><button type="button" className="text-button" onClick={() => setTab('profile')}>Adjust your preferences <ArrowUpRight size={14}/></button></section>
            <div className="quiet-tip"><Sparkles size={17}/><p>Light is your body clock’s strongest time cue. Small changes at the right time can help.</p></div>
          </aside></div>
        </>}

        {tab === 'plan' && <>
          <div className="page-heading"><div><span className="eyebrow muted">One journey. One continuous rhythm.</span><h1>Your travel plan</h1><p>From the first preparation day to your final arrival.</p></div><div className="heading-actions">{isDemo && <span className="pill demo-pill">Example trip</span>}{plan && trip && <button type="button" className="button secondary" onClick={() => exportCalendar(plan, trip, data.preferences.calendarAlarms !== false)}><Download size={16}/>Calendar</button>}</div></div>
          {!trip || !plan ? (result.loading ? <p className="small-copy">You can keep editing your trip while your plan is calculated.</p> : <EmptyPlan onCreate={createTrip}/>) : <>
            <div className="plan-trip-bar"><div className="plan-trip-name"><span className="small-icon"><Plane size={19}/></span><div><h2>{trip.name}</h2><span>{plural(plan.summary.destinations, 'destination')} · {plural(plan.summary.timeZoneChanges, 'time zone change')}</span></div></div><button type="button" className="text-button" onClick={() => editTrip(trip)}><Pencil size={14}/>Edit trip</button></div>
            {isDemo && <div className="demo-note"><Info size={16}/><p>Explore the example plan, then replace it with your own trip.</p><button type="button" onClick={createTrip}>Add your flights <ArrowRight size={14}/></button></div>}
            <div className="day-navigation" role="group" aria-label="Choose a plan day">{calendarDays.map(day => <button type="button" key={day.id} className={`day-button ${day.travelSegments?.length ? 'travel-day' : ''} ${day.id === selectedDay?.id ? 'selected' : ''}`} data-date={day.date} data-zone={day.timeZone} title={`${dateLabel(day.date, 'long')} · ${city(day.timeZone)}${day.travelSegments?.length ? ` · ${day.travelSegments.map(segment => segment.flightNumber || `${segment.departureAirport} → ${segment.arrivalAirport}`).join(', ')}` : ''}`} aria-pressed={day.id === selectedDay?.id} onClick={() => setSelectedDayId(day.id)}><span>{dateLabel(day.date).split(',')[0].split(' ')[0]}</span><strong>{Number(day.date.slice(8, 10))}</strong><small>{day.travelSegments?.length ? <><Plane size={11}/>Travel</> : day.stage === 'preparation' ? 'Prepare' : day.stage === 'home' ? 'Home' : city(day.timeZone)}</small>{Boolean(day.travelSegments?.length) && <span className="day-zone">{[...new Set(day.travelSegments.flatMap(segment => [segment.departureAirport, segment.arrivalAirport]))].join(' · ')}</span>}</button>)}</div>
            {selectedDay && <div className="plan-layout"><section><div className="agenda-heading"><div><span className={`stage-label ${selectedDay.stage}`}>{selectedDay.travelSegments?.length ? <Plane size={13}/> : <span/>}{selectedDay.label}</span><h2>{dateLabel(selectedDay.date, 'long')}</h2><p className="timezone-caption"><Globe2 size={14}/>{selectedDay.travelSegments?.length ? 'One date, both airport clocks. Every time includes its local date.' : `All times in ${city(selectedDay.timeZone)} · ${zoneName(selectedDay.timeZone, selectedDay.actions[0]?.start)}`}</p></div><div className="day-arrows"><button type="button" className="icon-button" aria-label="Previous plan day" disabled={calendarDays.indexOf(selectedDay) === 0} onClick={() => setSelectedDayId(calendarDays[calendarDays.indexOf(selectedDay) - 1]?.id)}><ChevronLeft size={18}/></button><button type="button" className="icon-button" aria-label="Next plan day" disabled={calendarDays.indexOf(selectedDay) === calendarDays.length - 1} onClick={() => setSelectedDayId(calendarDays[calendarDays.indexOf(selectedDay) + 1]?.id)}><ChevronRight size={18}/></button></div></div>
              {selectedDay.travelSegments?.length ? <section className="day-flights" aria-label="Flights on this plan day"><h3 className="agenda-section-title"><Plane size={15}/>Flights on this day</h3>{selectedDay.travelSegments.map(segment => <FlightSegmentCard key={segment.id} segment={segment}/>)}</section> : null}
              <div className="agenda-list">{selectedDay.actions.map(action => <ActionCard key={action.id} action={action} travelSegments={selectedDay.travelSegments} isCurrent={!isDemo && action.id === currentAction?.id} record={trip.adherence?.find(entry=>entry.actionId===action.id)} onRecord={isDemo?undefined:setRecordAction}/>)}</div>{selectedDay.actions.length === 0 && <div className="empty-card subtle"><Moon size={25}/><p>{selectedDay.travelSegments?.length ? 'Your flights are shown above. There are no additional recommendations on this day; short flights may have no usable rest window.' : 'No special actions on this day. Keep your regular sleep routine.'}</p></div>}
            </section><aside className="plan-aside"><section className="plan-note-card"><span className="eyebrow muted"><Sparkles size={14}/>Your body clock</span><h3>A gradual adjustment</h3>{selectedDay.phaseEstimateAvailable !== false ? <div className="phase-meter"><span>{plan.model ? 'Modeled' : 'Assumed'} body-clock change</span><strong>{phaseChangeLabel(selectedDay.phaseShiftHours)}</strong></div> : <div className="phase-unavailable"><span>{plan.model ? 'Modeled' : 'Assumed'} body-clock change</span><p>Not enough modeled history for this date.</p></div>}<p>{selectedDay.note}</p><p className="small-copy">{plan.model ? `Change since the previous simulated biological low, shown in ${city(selectedDay.timeZone)} time. This is an estimate, not a measurement.` : 'Progress assumes population adjustment rates; your response may differ.'} <a href="/science.html#limits">How estimates work</a></p></section><section className="plan-note-card muted-card"><h3>Make the plan work for you</h3><p>Seek outdoor light when you can. For light avoidance, dim indoor lighting and reduce bright screens.</p><button type="button" className="text-button" onClick={() => setScienceOpen(true)}>Understand the timing <ArrowUpRight size={14}/></button></section></aside></div>}

            {trip.adherence?.length ? <details className="plan-warnings"><summary>Your recorded history <span>{trip.adherence.length}</span></summary><ul>{trip.adherence.slice().reverse().map(entry=><li key={entry.id}>{actionMeta[entry.type].label} · {dateLabel(entry.scheduledStart)} {time(entry.scheduledStart,entry.timeZone)} · {entry.status}</li>)}</ul></details> : null}
            {plan.warnings.length > 0 && <details className="plan-warnings"><summary><Info size={16}/>Plan notes & limitations <span>{plan.warnings.length}</span></summary><ul>{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          </>}
        </>}

        {tab === 'trips' && <>
          <div className="page-heading"><div><span className="eyebrow muted">Every stop belongs in the story</span><h1>Your trips</h1><p>Connections, longer stays, and the journey home.</p></div><button type="button" className="button primary" onClick={createTrip}><Plus size={17}/>New trip</button></div>
          <div className="trips-grid">{data.trips.map(value => <section className={`saved-trip-card ${trip?.id === value.id ? 'selected-trip' : ''}`} key={value.id}><div className="saved-trip-top"><span className="small-icon"><Plane size={20}/></span><div className="saved-trip-badges">{value.id.startsWith('demo-') && <span className="pill demo-pill">Example</span>}{trip?.id === value.id && <span className="pill selected-pill"><Check size={12}/>Selected</span>}</div></div><h2>{value.name}</h2><p className="trip-dates">{dateLabel(value.legs[0]?.departureDateTime ?? '')}{value.legs.length > 1 && ` – ${dateLabel(value.legs.at(-1)?.arrivalDateTime ?? '')}`}</p><div className="mini-itinerary">{value.legs.map((leg, index) => <div className="mini-leg" key={leg.id}><div className="mini-leg-track"><span className={`itinerary-dot ${leg.stayAfter === 'connection' ? 'hollow' : ''}`}/>{index < value.legs.length - 1 && <span className="itinerary-line"/>}</div><div><strong>{index === 0 ? `${airportCity(leg.departureAirport)} → ` : ''}{airportCity(leg.arrivalAirport)}</strong><span>{leg.stayAfter === 'connection' ? 'Connection' : leg.strategy === 'home' ? 'Keep home rhythm' : leg.strategy === 'partial' ? 'Partial adjustment' : 'Adjust to destination'}{leg.flightNumber && ` · ${leg.flightNumber}`}</span>{aircraftLabel(leg.aircraft) && <small className="mini-aircraft">Aircraft · {aircraftLabel(leg.aircraft)}</small>}</div><span className="mini-airport">{leg.arrivalAirport}</span></div>)}</div>{value.legs.some(leg=>leg.flightSource==='aerodatabox')&&<p className="provider-attribution"><a href="https://aerodatabox.com/" target="_blank" rel="noopener">Originally imported from AeroDataBox</a> · retrieved {new Date(value.legs.filter(leg=>leg.flightSource==='aerodatabox').map(leg=>leg.flightFetchedAt!).sort().at(-1)!).toLocaleString()}. Recheck your booking for changes.</p>}<div className="saved-trip-actions"><button type="button" className="button secondary" onClick={() => { selectTrip(value.id); setTab('plan'); }}>View plan <ArrowRight size={15}/></button><button type="button" className="icon-button" aria-label={`Edit ${value.name}`} onClick={() => editTrip(value)}><Pencil size={16}/></button><button type="button" className="icon-button danger-icon" aria-label={`Delete ${value.name}`} onClick={() => setDeleteTripId(value.id)}><Trash2 size={16}/></button></div></section>)}
            <button type="button" className="add-trip-card" onClick={createTrip}><span><Plus size={24}/></span><strong>Where to next?</strong><p>Build a plan around your next adventure.</p></button>
          </div><div className="manual-entry-note"><Info size={16}/><p>Enter your booking manually, or look up a flight by number and departure date when signed in. Always confirm the airports and times against your booking.</p></div>
        </>}

        {tab === 'profile' && <Profile {...props} onNotice={setNotice}/>}
        <footer className="page-footer"><span><Moon size={12}/>A better rhythm, wherever life takes you.</span><a href="/science.html">Science & further reading <ArrowUpRight size={12}/></a></footer>
      </main>
    </div>
    <nav className="mobile-navigation" aria-label="Mobile navigation">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
    {notice && <div className="toast" role="status"><CheckCircle2 size={17}/>{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15}/></button></div>}
    {scienceOpen && <ScienceModal onClose={() => setScienceOpen(false)}/>}
    {draftTrip && <TripEditor trip={draftTrip} setTrip={setDraftTrip} errors={tripErrors} onSave={saveTrip} onClose={() => setDraftTrip(null)} existing={data.trips.some(t => t.id === draftTrip.id)} accountId={account?.id??null} flightLookupAvailable={Boolean(authConfig.flightLookupAvailable)}/>}
    {deleteTripId && <Modal title="Delete this trip?" onClose={() => setDeleteTripId(null)} className="small-modal"><p className="modal-intro">The itinerary, recorded history, and imported flight details will be removed{account ? ' from your account' : ' from this device'}. This cannot be undone.</p><div className="modal-footer"><button type="button" className="button secondary" onClick={() => setDeleteTripId(null)}>Keep trip</button><button type="button" className="button danger" onClick={removeTrip}><Trash2 size={15}/>Delete trip</button></div></Modal>}
    {recordAction && trip && <Modal title="Record your actual experience" onClose={()=>setRecordAction(null)} className="small-modal"><AdherenceForm action={recordAction} tripId={trip.id} existing={trip.adherence?.find(entry=>entry.actionId===recordAction.id)} onSave={saveRecord} onClose={()=>setRecordAction(null)}/></Modal>}
    <datalist id="time-zones">{commonZones.map(zone => <option key={zone} value={zone}/>)}</datalist>
  </div>;
}

function AccountAvatar({ account }: { account: Account | null }) {
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  const initials = account?.name.trim().split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'R';
  return account?.picture && failedPicture !== account.picture
    ? <img className="account-avatar-image" src={account.picture} alt="" referrerPolicy="no-referrer" onError={() => setFailedPicture(account.picture ?? null)}/>
    : account ? <span aria-hidden="true">{initials}</span> : <UserRound size={19} aria-hidden="true"/>;
}

function AccountMenu({ account, accountReady, clientId, onProfile, onGoogleSignIn, onSignInError, onSignOut }: {
  account: Account | null;
  accountReady: boolean;
  clientId: string | null;
  onProfile: () => void;
  onGoogleSignIn: (account: Account) => void;
  onSignInError: (error: Error) => void;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  useEffect(() => { setOpen(false); setError(null); }, [account?.id]);
  async function act(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); setOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.'); } finally { setBusy(false); }
  }
  return <div className="account-menu" ref={container} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    {account ? <button ref={trigger} type="button" className={`topbar-avatar ${account.picture ? 'has-picture' : ''}`} aria-label={`${account.name}'s account menu`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={busy} onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
    }}>{busy ? <LoaderCircle size={19} className="spin"/> : <AccountAvatar account={account}/>}</button>
      : clientId ? <GoogleSignInButton clientId={clientId} onSuccess={onGoogleSignIn} onError={onSignInError} compact/>
        : <button type="button" className="topbar-avatar" aria-label="Open your profile" onClick={onProfile}><UserRound size={19}/></button>}
    {open && account && <div className="account-dropdown">
      <div className="account-menu-identity"><strong>{account.name}</strong><span>{account.email}</span></div>
      <div id={menuId} role="menu" aria-label="Your account" ref={menu} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
        if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[target]?.focus();
      }}>
        <button type="button" role="menuitem" tabIndex={-1} disabled={busy} onClick={() => { onProfile(); setOpen(false); trigger.current?.focus(); }}><UserRound size={17}/>Sleep preferences</button>
        <button type="button" role="menuitem" tabIndex={-1} disabled={busy} onClick={() => void act(onSignOut)}><LogOut size={17}/>Sign out</button>
      </div>
      {!accountReady && clientId && <div className="account-menu-signin"><GoogleSignInButton clientId={clientId} onSuccess={onGoogleSignIn} onError={onSignInError}/></div>}
      {error && <p className="account-menu-error" role="alert">{error}</p>}
    </div>}
    {!open && error && <p className="account-menu-error standalone" role="alert">{error}</p>}
  </div>;
}

function EmptyPlan({ onCreate }: { onCreate: () => void }) {
  return <section className="empty-card large-empty"><span className="empty-orbit"><Moon size={35}/></span><h2>Your next journey starts here</h2><p>Add your flights and we’ll build a continuous plan for every stop.</p><button type="button" className="button primary" onClick={onCreate}><Plus size={16}/>Plan a trip</button></section>;
}

function Profile(props: AppProps & { onNotice: (message: string) => void }) {
  const { data, onChange, account, authConfig, saveStatus, onNotice } = props;
  const [preferences, setPreferences] = useState<Preferences>({ ...data.preferences });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [deleteCloud, setDeleteCloud] = useState(false);
  const [clearLocal, setClearLocal] = useState(false);
  const committedPreferences = useRef({ accountId: account?.id ?? null, preferences: data.preferences });
  const dirty = JSON.stringify(preferences) !== JSON.stringify(data.preferences);
  const duration = sleepSpan(preferences.preferredBedtime, preferences.preferredWakeTime);
  const conflicting = Math.abs(duration - preferences.sleepHours) > 0.1;
  useEffect(() => {
    const accountId = account?.id ?? null;
    const previous = committedPreferences.current;
    committedPreferences.current = { accountId, preferences: data.preferences };
    if (previous.accountId !== accountId) {
      setPreferences({ ...data.preferences });
      setErrors([]); setAuthError(null); setDeleteCloud(false); setClearLocal(false);
      return;
    }
    // A background account refresh updates untouched fields without discarding
    // edits that have not yet been submitted with Save preferences.
    setPreferences(draft => {
      const next = { ...data.preferences };
      const preserveEdit = <K extends keyof Preferences>(key: K) => {
        if (!Object.is(draft[key], previous.preferences[key])) next[key] = draft[key];
      };
      (Object.keys(draft) as (keyof Preferences)[]).forEach(preserveEdit);
      return next;
    });
  }, [account?.id, data.preferences]);
  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) { setPreferences(p => ({ ...p, [key]: value })); }
  function save(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: string[] = [];
    try { new Intl.DateTimeFormat('en', { timeZone: preferences.homeTimeZone }).format(new Date()); } catch { nextErrors.push('Enter a valid home time zone, such as Europe/London.'); }
    if (!Number.isFinite(preferences.sleepHours) || preferences.sleepHours < 4 || preferences.sleepHours > 12) nextErrors.push('Choose a sleep duration between 4 and 12 hours.');
    if (preferences.melatonin && !preferences.melatoninAcknowledged) nextErrors.push('Review and acknowledge the melatonin suitability information, or turn melatonin off.');
    if (nextErrors.length) { setErrors(nextErrors); return; }
    onChange({ ...data, preferences }); setErrors([]); onNotice('Preferences saved. Your plans have been regenerated.');
  }
  async function authAction(name: string, action: () => Promise<void>) {
    setBusy(name); setAuthError(null);
    try { await action(); return true; } catch (error) { setAuthError(error instanceof Error ? error.message : 'The account action could not be completed. Please try again.'); return false; } finally { setBusy(null); }
  }
  return <><div className="page-heading"><div><span className="eyebrow muted">Personal by design</span><h1>Your natural rhythm</h1><p>A better travel plan starts with how you sleep at home.</p></div></div>
    <div className="profile-layout"><form className="preferences-form" onSubmit={save}>
      {errors.length > 0 && <div className="alert error-alert" role="alert"><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
      <section className="form-section"><div className="form-section-title"><span className="small-icon"><Globe2 size={19}/></span><div><h2>Home base</h2><p>Where your everyday body clock lives.</p></div></div><label className="field"><span>Home time zone</span><input list="time-zones" value={preferences.homeTimeZone} onChange={event => update('homeTimeZone', event.target.value)} required/><small>Use an IANA time zone, for example America/New_York.</small></label><fieldset className="chronotype-fieldset"><legend>Which sounds most like you?</legend><div className="chronotype-options">{([{ value: 'early', label: 'Early bird', detail: 'Mornings feel natural', icon: Sun }, { value: 'intermediate', label: 'In between', detail: 'Somewhere in the middle', icon: Clock3 }, { value: 'late', label: 'Night owl', detail: 'Evenings are my time', icon: Moon }, { value: 'unsure', label: 'Not sure', detail: 'Use my usual sleep times', icon: Sparkles }] as const).map(({ value, label, detail, icon: Icon }) => <label className={`chronotype-option ${preferences.chronotype === value ? 'chosen' : ''}`} key={value}><input type="radio" name="chronotype" value={value} checked={preferences.chronotype === value} onChange={() => update('chronotype', value)}/><Icon size={22}/><strong>{label}</strong><small>{detail}</small>{preferences.chronotype === value && <Check size={14} className="choice-check"/>}</label>)}</div></fieldset></section>
      <section className="form-section"><div className="form-section-title"><span className="small-icon"><Moon size={19}/></span><div><h2>Your sleep, your way</h2><p>Your usual schedule estimates your starting body clock.</p></div></div><div className="field-grid"><label className="field"><span>Usual bedtime</span><input type="time" value={preferences.usualBedtime} onChange={event => update('usualBedtime', event.target.value)} required/></label><label className="field"><span>Usual wake time</span><input type="time" value={preferences.usualWakeTime} onChange={event => update('usualWakeTime', event.target.value)} required/></label></div><div className="field-grid"><label className="field"><span>Preferred travel bedtime</span><input type="time" value={preferences.preferredBedtime} onChange={event => update('preferredBedtime', event.target.value)} required/></label><label className="field"><span>Preferred travel wake time</span><input type="time" value={preferences.preferredWakeTime} onChange={event => update('preferredWakeTime', event.target.value)} required/></label></div><div className="field-grid"><label className="field"><span>Hours of sleep you need</span><div className="input-with-unit"><input type="number" min="4" max="12" step="0.5" value={preferences.sleepHours} onChange={event => update('sleepHours', Number(event.target.value))} required/><span>hours</span></div></label><label className="field"><span>Keep this preference fixed</span><select value={preferences.sleepAnchor} onChange={event => update('sleepAnchor', event.target.value as 'wake' | 'bed')}><option value="wake">Wake time — adjust bedtime</option><option value="bed">Bedtime — adjust wake time</option></select></label></div>{conflicting && <div className="inline-note"><Info size={16}/><p>Your preferred times allow {duration} hours. The plan will preserve your {preferences.sleepAnchor === 'wake' ? 'wake time' : 'bedtime'} and adjust the other time to provide {preferences.sleepHours} hours.</p></div>}</section>
      <section className="form-section"><div className="form-section-title"><span className="small-icon"><Sparkles size={19}/></span><div><h2>Your planning preferences</h2><p>Choose the tools that feel right for you.</p></div></div><Toggle checked={preferences.caffeine} onChange={value => update('caffeine', value)} icon={Coffee} title="Include caffeine windows" description="Optional timing guidance for coffee, tea, and other caffeine."/><Toggle checked={preferences.melatonin} onChange={value => update('melatonin', value)} icon={Sparkles} title="Include melatonin guidance" description="Optional timing windows and an informational 0.5–1 mg range."/>
        {preferences.melatonin && <div className="melatonin-info"><h3>Before including melatonin</h3><p>Timing matters. Melatonin can cause drowsiness, interact with medicines, and vary in quality. Check suitability with a clinician, especially if pregnant, breastfeeding, taking medicines, or managing a health condition. Guidance is for adults and is not a personal prescription.</p><a href="https://www.nccih.nih.gov/health/melatonin-what-you-need-to-know" target="_blank" rel="noreferrer">Read NCCIH guidance <ExternalLink size={12}/></a><label className="checkbox-label"><input type="checkbox" checked={preferences.melatoninAcknowledged} onChange={event => update('melatoninAcknowledged', event.target.checked)} required={preferences.melatonin}/><span>I have reviewed this information and will check whether melatonin is suitable for me.</span></label></div>}
        <label className="field"><span>Planning approach</span><select value={preferences.planningMode??'model'} onChange={event=>update('planningMode',event.target.value as 'model'|'rules')}><option value="model">Published circadian model (experimental)</option><option value="rules">Conservative planning rules</option></select><small>The model compares gradual advance and delay plans; personal phase and light exposure remain estimates. <a href="/science.html#limits">Read how it works.</a></small></label><Toggle checked={preferences.calendarAlarms!==false} onChange={value=>update('calendarAlarms',value)} icon={CalendarDays} title="Calendar reminders" description="Include reminders 10 minutes before actions in calendar exports."/>
        <label className="field preparation-field"><span>Start preparing before departure</span><select value={preferences.preparationDays} onChange={event => update('preparationDays', Number(event.target.value))}><option value="0">On departure day</option><option value="1">1 day before</option><option value="2">2 days before</option><option value="3">3 days before</option></select><small>More preparation time can make the first travel day easier.</small></label>
      </section><div className="preferences-save"><span>{dirty ? 'You have unsaved changes' : account ? saveStatus || 'Changes save to your account automatically' : 'Preferences saved on this device'}</span><button type="submit" className="button primary" disabled={!dirty}><Check size={16}/>Save preferences</button></div>
    </form><aside className={`profile-aside ${account ? 'has-account' : ''}`}>
      {!account && <section className="account-card">
        <span className="eyebrow muted"><ShieldCheck size={14}/>Your account</span>
        <h2>Take your rhythm with you</h2>
        <p>Save your preferences and trips to your Google-linked account.</p>
        {authConfig.googleClientId ? <GoogleSignInButton clientId={authConfig.googleClientId} onSuccess={props.onGoogleSignIn} onError={props.onSignInError}/> : <p className="small-copy auth-config-note">Google sign-in is unavailable. You can still plan trips on this device.</p>}
      </section>}
      <section className="privacy-card"><span className="small-icon"><ShieldCheck size={20}/></span>
        <h3>{account ? 'Your plans, wherever you go' : 'Designed to travel light'}</h3>
        <p>{account ? 'Your preferences and trips save to your account automatically and are ready when you sign in on another device.' : 'Your preferences and trips stay on this device until you sign in.'}</p>
        <p className="small-copy">{account ? 'An offline copy keeps your plans available when you travel. Changes made offline save to your account when you reconnect.' : 'Your saved plan stays available offline after the app has loaded.'} You can export a backup at any time.</p>
        {authError && <div className="inline-error" role="alert">{authError}</div>}
        <button type="button" className="button secondary full-width" onClick={() => exportData(data)}><Download size={15}/>Export your data</button>
        <button type="button" className="text-button cloud-delete-button" disabled={Boolean(busy)} onClick={() => { setAuthError(null); setClearLocal(true); }}><Trash2 size={13}/>{account ? 'Clear offline copy' : 'Clear data on this device'}</button>
        {account && authConfig.syncAvailable && <button type="button" className="text-button danger-text cloud-delete-button" disabled={Boolean(busy) || !props.accountReady} onClick={() => { setAuthError(null); setDeleteCloud(true); }}><Trash2 size={13}/>Delete saved account data</button>}
      </section>
    </aside></div>
    {clearLocal && <Modal title={account ? 'Clear your offline copy?' : 'Clear data on this device?'} className="small-modal" onClose={() => setClearLocal(false)}><p className="modal-intro">{account ? 'Your saved preferences and trips stay in your account. Rephase will reload them when you are online.' : 'This deletes trips, sleep preferences, and cached plans saved on this device. Export your data first if you want a backup.'}</p>{authError && <div className="inline-error" role="alert">{authError}</div>}<div className="modal-footer"><button type="button" className="button secondary" onClick={() => setClearLocal(false)}>Cancel</button><button type="button" className="button danger" disabled={Boolean(busy)} onClick={async () => { if (await authAction('clear', props.onClearLocal)) setClearLocal(false); }}>{busy === 'clear' && <LoaderCircle size={15} className="spin"/>}{account ? 'Clear offline copy' : 'Clear local data'}</button></div></Modal>}
    {deleteCloud && <Modal title="Delete saved account data?" className="small-modal" onClose={() => setDeleteCloud(false)}><p className="modal-intro">This deletes your saved preferences, trips, and recorded history from your account and clears their offline copy on this device. This cannot be undone.</p>{authError && <div className="inline-error" role="alert">{authError}</div>}<div className="modal-footer"><button type="button" className="button secondary" onClick={() => setDeleteCloud(false)}>Cancel</button><button type="button" className="button danger" disabled={Boolean(busy)} onClick={async () => { if (await authAction('delete', props.onDeleteAccountData)) setDeleteCloud(false); }}>{busy === 'delete' && <LoaderCircle size={15} className="spin"/>}Delete account data</button></div></Modal>}
  </>;
}

function Toggle({ checked, onChange, icon: Icon, title, description }: { checked: boolean; onChange: (v: boolean) => void; icon: typeof Sun; title: string; description: string }) {
  return <label className="toggle-row"><span className="toggle-icon"><Icon size={20}/></span><span className="toggle-copy"><strong>{title}</strong><small>{description}</small></span><span className={`toggle ${checked ? 'on' : ''}`}><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/><span/></span></label>;
}

function ScienceModal({ onClose }: { onClose: () => void }) {
  return <Modal title="The science of a softer landing" onClose={onClose} className="science-modal"><div className="science-intro"><span className="science-intro-icon"><Sparkles size={27}/></span><p>Jet lag happens when your internal clock and the time around you fall out of step. Carefully timed light and sleep can help bring them closer together.</p></div><div className="science-principles"><article><Sun size={22}/><div><h3>Light sets the pace</h3><p>Light can move your body clock earlier or later depending on when it reaches you. That’s why your plan includes both light exposure and light avoidance.</p></div></article><article><Moon size={22}/><div><h3>Sleep protects the journey</h3><p>A consistent sleep opportunity supports alertness and recovery. Your plan combines your sleep needs with gradual adjustment across the full itinerary.</p></div></article><article><Coffee size={22}/><div><h3>Optional tools, carefully timed</h3><p>Caffeine may support alertness while affecting later sleep. Melatonin timing matters; optional guidance uses the CDC’s informational 0.5–1 mg range, without personalized dosing.</p></div></article></div><div className="science-limitations"><Info size={18}/><div><h3>What this plan can tell you</h3><p>Rephase offers a published light-driven circadian model and conservative planning rules. Circadian phase and adjustment are estimates from your usual sleep schedule, rather than measurements. The app has not been clinically validated and does not reproduce Timeshifter’s proprietary algorithm.</p><p>Flight schedules, daylight exposure, actual sleep, health conditions, and individual responses can change the outcome. Review plan notes, and use professional advice for medical decisions.</p></div></div><p><a href="/science.html">Read the full Science page, including studies and model assumptions <ArrowUpRight size={14}/></a></p><h3 className="source-heading">Read the evidence</h3><div className="source-links"><a href="https://www.cdc.gov/yellow-book/hcp/travel-air-sea/jet-lag-disorder.html" target="_blank" rel="noreferrer"><span><strong>CDC Yellow Book</strong><small>Jet lag disorder: light, sleep, caffeine, and melatonin</small></span><ArrowUpRight size={18}/></a><a href="https://www.nccih.nih.gov/health/melatonin-what-you-need-to-know" target="_blank" rel="noreferrer"><span><strong>NCCIH · Melatonin</strong><small>Evidence, suitability, interactions, and product quality</small></span><ArrowUpRight size={18}/></a></div><div className="modal-footer"><button type="button" className="button primary" onClick={onClose}>Back to my rhythm <ArrowRight size={16}/></button></div></Modal>;
}
