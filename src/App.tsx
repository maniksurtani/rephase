import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppData, Account, FlightLeg, PlanAction, Preferences, Trip } from './lib/types';
import { generatePlan, validateTrip } from './lib/plan';
import { AIRPORTS, findAirport } from './lib/airports';
import { createEmptyTrip, createLeg } from './lib/defaults';
import { exportCalendar, exportData } from './lib/export';
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Cloud, Coffee, Download, ExternalLink, EyeOff, Globe2, Info, LoaderCircle, LogOut, Moon, Pencil, Plane, Plus, ShieldCheck, Sparkles, Sun, Trash2, UserRound, X } from 'lucide-react';
import './styles.css';

export interface AppProps {
  data: AppData;
  onChange: (data: AppData) => void;
  account: Account | null;
  authConfig: { googleClientId: string | null; syncAvailable: boolean };
  syncStatus: string;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSync: () => Promise<void>;
  onDeleteCloud: () => Promise<void>;
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

function ActionCard({ action, compact = false, isCurrent = false }: { action: PlanAction; compact?: boolean; isCurrent?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = actionMeta[action.type];
  const Icon = meta.icon;
  const differentDay = localDate(action.start, action.timeZone) !== localDate(action.end, action.timeZone);
  return <article className={`action-card ${meta.color} ${compact ? 'compact' : ''} ${isCurrent ? 'current' : ''}`}>
    <div className="action-time"><strong>{time(action.start, action.timeZone)}</strong><span>{time(action.end, action.timeZone)}{differentDay && <small> +1 day</small>}</span></div>
    <div className="action-symbol"><Icon size={20}/></div>
    <div className="action-content"><div className="action-title-line"><h3>{action.title}</h3>{isCurrent && <span className="live-label">Now</span>}</div><p>{action.detail}</p>{action.dose && <span className="dose-label">Informational dose range: {action.dose}</span>}
      {!compact && <button type="button" className="why-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><Info size={13}/>{expanded ? 'Hide explanation' : 'Why this helps'}<ChevronRight size={13} className={expanded ? 'rotated' : ''}/></button>}
      {expanded && <div className="action-explanation"><p>{action.reason}</p>{action.evidenceUrl && <a href={action.evidenceUrl} target="_blank" rel="noreferrer">Read the source <ExternalLink size={12}/></a>}</div>}
    </div>
  </article>;
}

export default function App(props: AppProps) {
  const { data, onChange, account, authConfig, syncStatus, storageError } = props;
  const [tab, setTab] = useState<Tab>('today');
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [scienceOpen, setScienceOpen] = useState(false);
  const [draftTrip, setDraftTrip] = useState<Trip | null>(null);
  const [tripErrors, setTripErrors] = useState<string[]>([]);
  const [deleteTripId, setDeleteTripId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const trip = data.trips.find(t => t.id === data.selectedTripId) ?? data.trips[0] ?? null;
  const result = useMemo(() => {
    if (!trip) return { plan: null, error: null };
    try { return { plan: generatePlan(trip, data.preferences), error: null }; }
    catch (error) { return { plan: null, error: error instanceof Error ? error.message : 'This itinerary needs a few corrections before we can generate a plan.' }; }
  }, [trip, data.preferences]);
  const plan = result.plan;
  const isDemo = trip?.id.startsWith('demo-') ?? false;
  const allActions = plan?.days.flatMap(day => day.actions).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)) ?? [];
  const currentAction = allActions.find(a => Date.parse(a.start) <= now.getTime() && Date.parse(a.end) > now.getTime());
  const nextAction = allActions.find(a => Date.parse(a.start) > now.getTime());
  const currentDay = plan?.days.find(day => day.actions.some(action => action.id === currentAction?.id));
  const nextDay = plan?.days.find(day => day.actions.some(action => action.id === nextAction?.id));
  const today = currentDay ?? (nextDay?.date === localDate(now, nextDay?.timeZone ?? 'UTC') ? nextDay : plan?.days.filter(day => day.date === localDate(now, day.timeZone)).at(-1));
  const upcomingDay = currentDay ?? nextDay;
  const defaultDay = today ?? upcomingDay ?? plan?.days[0];
  const selectedDay = plan?.days.find(day => day.id === selectedDayId) ?? defaultDay;
  const timelineDay = today ?? upcomingDay;
  const itineraryFinished = Boolean(plan?.days.length && !upcomingDay);

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { setSelectedDayId(null); }, [trip?.id]);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(null), 4500); return () => window.clearTimeout(timer); } }, [notice]);
  useEffect(() => {
    const open = scienceOpen || Boolean(draftTrip) || Boolean(deleteTripId);
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [scienceOpen, draftTrip, deleteTripId]);

  function editTrip(value: Trip) { setDraftTrip({ ...value, legs: value.legs.map(l => ({ ...l })) }); setTripErrors([]); }
  function createTrip() { setDraftTrip(createEmptyTrip()); setTripErrors([]); }
  function selectTrip(id: string) { onChange({ ...data, selectedTripId: id }); setSelectedDayId(null); }
  function saveTrip() {
    if (!draftTrip) return;
    const errors = validateTrip(draftTrip);
    if (!draftTrip.name.trim()) errors.unshift('Give your trip a name.');
    if (errors.length) { setTripErrors(errors); return; }
    const saved = { ...draftTrip, id: draftTrip.id.startsWith('demo-') ? crypto.randomUUID() : draftTrip.id, name: draftTrip.name.trim(), updatedAt: new Date().toISOString() };
    onChange({ ...data, trips: data.trips.some(t => t.id === draftTrip.id) ? data.trips.map(t => t.id === draftTrip.id ? saved : t) : [...data.trips, saved], selectedTripId: saved.id });
    setDraftTrip(null); setTab('plan'); setNotice('Trip saved. Your full itinerary plan is ready.');
  }
  function removeTrip() {
    const remaining = data.trips.filter(t => t.id !== deleteTripId);
    onChange({ ...data, trips: remaining, selectedTripId: data.selectedTripId === deleteTripId ? remaining[0]?.id ?? null : data.selectedTripId });
    setDeleteTripId(null); setNotice('Trip deleted from this device.');
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <a href="#" className="brand" onClick={event => { event.preventDefault(); setTab('today'); }} aria-label="Rephase home"><span className="brand-mark"><Moon size={21}/></span><span>rephase<span className="brand-dot">.</span></span></a>
      <p className="sidebar-caption">Find your travel rhythm</p>
      <nav className="main-navigation" aria-label="Main navigation">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={`nav-item ${tab === id ? 'active' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={20}/><span>{label}</span>{tab === id && <span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="science-teaser"><div className="science-orbit"><Sparkles size={18}/></div><p>A little science.<br/>A better arrival.</p><button type="button" onClick={() => setScienceOpen(true)}>The science behind Rephase <ArrowUpRight size={14}/></button></div>
        <button type="button" className="account-shortcut" onClick={() => setTab('profile')}><span className="avatar">{account ? account.name.slice(0, 1).toUpperCase() : <UserRound size={18}/>}</span><span><strong>{account?.name ?? 'Your profile'}</strong><small>{account ? 'Google account' : 'Saved on this device'}</small></span><ChevronRight size={16}/></button>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="mobile-brand"><Moon size={21}/><span>rephase.</span></div><span className="topbar-label">{tab === 'today' ? 'Your rhythm, wherever you go' : tabs.find(t => t.id === tab)?.label}</span><div className="topbar-actions"><span className="local-status"><span/>{account ? 'Connected' : 'On-device privacy'}</span><button type="button" className="icon-button" aria-label="Learn about the science" onClick={() => setScienceOpen(true)}><Info size={19}/></button><button type="button" className="topbar-avatar" aria-label="Open your profile" onClick={() => setTab('profile')}>{account ? account.name.slice(0, 1).toUpperCase() : <UserRound size={17}/>}</button></div></header>
      <main id="main-content" className={`main-content page-${tab}`} tabIndex={-1}>
        {storageError && <div className="alert error-alert" role="alert"><Info size={17}/><span>{storageError}</span></div>}
        {result.error && <div className="alert error-alert"><Info size={17}/><span>{result.error}</span>{trip && <button type="button" onClick={() => editTrip(trip)}>Edit trip</button>}</div>}
        {tab === 'today' && <>
          <section className="welcome-hero"><div className="hero-copy"><span className="eyebrow"><span className="small-line"/>A softer landing</span><h1>New time zone.<br/><span>Same you.</span></h1><p>Your personal light, sleep, and travel plan.<br className="desktop-break"/> Arrive with your body clock a little more on your side.</p><button type="button" className="button primary hero-button" onClick={() => trip ? setTab('plan') : createTrip()}>{trip ? 'Explore your plan' : 'Plan your first trip'}<ArrowRight size={17}/></button></div><MoonScene/></section>
          <div className="dashboard-grid"><div className="dashboard-main">
            <div className="section-heading"><div><span className="eyebrow muted">Your next adventure</span><h2>{trip?.name ?? 'Where are you headed?'}</h2></div>{isDemo && <span className="pill demo-pill">Example trip</span>}</div>
            {trip ? <section className="trip-summary-card"><div className="trip-route">{trip.legs.slice(0, 5).map((leg, i) => <div className="route-segment" key={leg.id}>{i === 0 && <><div className="route-point"><span className="route-airport">{leg.departureAirport}</span><span>{airportCity(leg.departureAirport)}</span></div><div className="route-connector"><span/><Plane size={15}/><span/></div></>}<div className="route-point"><span className="route-airport">{leg.arrivalAirport}</span><span>{airportCity(leg.arrivalAirport)}</span>{leg.stayAfter === 'connection' && <small>Connection</small>}</div>{i < Math.min(trip.legs.length, 5) - 1 && <div className="route-connector"><span/><Plane size={15}/><span/></div>}</div>)}{trip.legs.length > 5 && <span className="more-stops">+{trip.legs.length - 5}</span>}</div><div className="trip-summary-footer"><span><CalendarDays size={15}/>{dateLabel(trip.legs[0]?.departureDateTime ?? '')}{trip.legs.length > 1 && ` – ${dateLabel(trip.legs.at(-1)?.arrivalDateTime ?? '')}`}</span><button type="button" className="text-button" onClick={() => setTab('trips')}>Trip details <ArrowUpRight size={15}/></button></div></section> : <section className="empty-card"><Plane size={28}/><h3>Start with your flights</h3><p>Add each stop, and we’ll connect the whole journey into one plan.</p><button type="button" className="button primary" onClick={createTrip}><Plus size={16}/>Add a trip</button></section>}
            {plan && <section className="today-section"><div className="section-heading"><div><span className="eyebrow muted">{today ? 'Your daily rhythm' : itineraryFinished ? 'Your journey' : 'A little preparation goes a long way'}</span><h2>{today ? 'Today, at a glance' : itineraryFinished ? 'This plan is complete' : 'Your first steps'}</h2></div>{timelineDay && <span className="subtle-label">{dateLabel(timelineDay.date)}</span>}</div>
              {isDemo && <div className="demo-note"><Info size={16}/><p>This is a sample itinerary. Add your flights and sleep preferences for a personal plan.</p><button type="button" onClick={createTrip}>Make it yours <ArrowRight size={14}/></button></div>}
              {!today && timelineDay && <div className="upcoming-note"><CalendarDays size={17}/><span>Your {timelineDay.stage === 'preparation' ? 'preparation' : 'next plan day'} begins <strong>{dateLabel(timelineDay.date, 'long')}</strong>. Times below are in {city(timelineDay.timeZone)} ({zoneName(timelineDay.timeZone, timelineDay.actions[0]?.start)}).</span></div>}
              {today && <p className="timezone-caption"><Globe2 size={14}/>{city(today.timeZone)} local time · {zoneName(today.timeZone, today.actions[0]?.start)}</p>}
              {timelineDay && <div className="action-list">{timelineDay.actions.slice(0, 3).map(action => <ActionCard key={action.id} action={action} compact isCurrent={!isDemo && action.id === currentAction?.id}/>)}</div>}
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
          <div className="page-heading"><div><span className="eyebrow muted">One journey. One continuous rhythm.</span><h1>Your travel plan</h1><p>From the first preparation day to your final arrival.</p></div><div className="heading-actions">{isDemo && <span className="pill demo-pill">Example trip</span>}{plan && trip && <button type="button" className="button secondary" onClick={() => exportCalendar(plan, trip)}><Download size={16}/>Calendar</button>}</div></div>
          {!trip || !plan ? <EmptyPlan onCreate={createTrip}/> : <>
            <div className="plan-trip-bar"><div className="plan-trip-name"><span className="small-icon"><Plane size={19}/></span><div><h2>{trip.name}</h2><span>{plural(plan.summary.destinations, 'destination')} · {plural(plan.summary.timeZoneChanges, 'time zone change')}</span></div></div><button type="button" className="text-button" onClick={() => editTrip(trip)}><Pencil size={14}/>Edit trip</button></div>
            {isDemo && <div className="demo-note"><Info size={16}/><p>Explore the example plan, then replace it with your own trip.</p><button type="button" onClick={createTrip}>Add your flights <ArrowRight size={14}/></button></div>}
            <div className="day-navigation" role="group" aria-label="Choose a plan day">{plan.days.map(day => <button type="button" key={day.id} className={`day-button ${day.id === selectedDay?.id ? 'selected' : ''}`} aria-pressed={day.id === selectedDay?.id} onClick={() => setSelectedDayId(day.id)}><span>{dateLabel(day.date).split(',')[0].split(' ')[0]}</span><strong>{Number(day.date.slice(8, 10))}</strong><small>{day.stage === 'preparation' ? 'Prepare' : day.stage === 'travel' ? 'Travel' : day.stage === 'home' ? 'Home' : city(day.timeZone)}</small></button>)}</div>
            {selectedDay && <div className="plan-layout"><section><div className="agenda-heading"><div><span className={`stage-label ${selectedDay.stage}`}><span/>{selectedDay.label}</span><h2>{dateLabel(selectedDay.date, 'long')}</h2><p className="timezone-caption"><Globe2 size={14}/>All times in {city(selectedDay.timeZone)} · {zoneName(selectedDay.timeZone, selectedDay.actions[0]?.start)}</p></div><div className="day-arrows"><button type="button" className="icon-button" aria-label="Previous plan day" disabled={plan.days.indexOf(selectedDay) === 0} onClick={() => setSelectedDayId(plan.days[plan.days.indexOf(selectedDay) - 1]?.id)}><ChevronLeft size={18}/></button><button type="button" className="icon-button" aria-label="Next plan day" disabled={plan.days.indexOf(selectedDay) === plan.days.length - 1} onClick={() => setSelectedDayId(plan.days[plan.days.indexOf(selectedDay) + 1]?.id)}><ChevronRight size={18}/></button></div></div>
              <div className="agenda-list">{selectedDay.actions.map(action => <ActionCard key={action.id} action={action} isCurrent={!isDemo && action.id === currentAction?.id}/>)}</div>{selectedDay.actions.length === 0 && <div className="empty-card subtle"><Moon size={25}/><p>No special actions on this day. Keep your regular sleep routine.</p></div>}
            </section><aside className="plan-aside"><section className="plan-note-card"><span className="eyebrow muted"><Sparkles size={14}/>Your body clock</span><h3>A gradual adjustment</h3><p>{selectedDay.note}</p><div className="phase-meter"><span>Estimated shift this day</span><strong>{Math.abs(selectedDay.phaseShiftHours).toFixed(1)}<small> hours</small></strong></div><p className="small-copy">Estimates start from your usual sleep schedule and continue through every destination.</p></section><section className="plan-note-card muted-card"><h3>Make the plan work for you</h3><p>Seek outdoor light when you can. For light avoidance, dim indoor lighting and reduce bright screens.</p><button type="button" className="text-button" onClick={() => setScienceOpen(true)}>Understand the timing <ArrowUpRight size={14}/></button></section></aside></div>}
            {plan.warnings.length > 0 && <details className="plan-warnings"><summary><Info size={16}/>Plan notes & limitations <span>{plan.warnings.length}</span></summary><ul>{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          </>}
        </>}

        {tab === 'trips' && <>
          <div className="page-heading"><div><span className="eyebrow muted">Every stop belongs in the story</span><h1>Your trips</h1><p>Connections, longer stays, and the journey home.</p></div><button type="button" className="button primary" onClick={createTrip}><Plus size={17}/>New trip</button></div>
          <div className="trips-grid">{data.trips.map(value => <section className={`saved-trip-card ${trip?.id === value.id ? 'selected-trip' : ''}`} key={value.id}><div className="saved-trip-top"><span className="small-icon"><Plane size={20}/></span><div className="saved-trip-badges">{value.id.startsWith('demo-') && <span className="pill demo-pill">Example</span>}{trip?.id === value.id && <span className="pill selected-pill"><Check size={12}/>Selected</span>}</div></div><h2>{value.name}</h2><p className="trip-dates">{dateLabel(value.legs[0]?.departureDateTime ?? '')}{value.legs.length > 1 && ` – ${dateLabel(value.legs.at(-1)?.arrivalDateTime ?? '')}`}</p><div className="mini-itinerary">{value.legs.map((leg, index) => <div className="mini-leg" key={leg.id}><div className="mini-leg-track"><span className={`itinerary-dot ${leg.stayAfter === 'connection' ? 'hollow' : ''}`}/>{index < value.legs.length - 1 && <span className="itinerary-line"/>}</div><div><strong>{index === 0 ? `${airportCity(leg.departureAirport)} → ` : ''}{airportCity(leg.arrivalAirport)}</strong><span>{leg.stayAfter === 'connection' ? 'Connection' : leg.strategy === 'home' ? 'Keep home rhythm' : leg.strategy === 'partial' ? 'Partial adjustment' : 'Adjust to destination'}{leg.flightNumber && ` · ${leg.flightNumber}`}</span></div><span className="mini-airport">{leg.arrivalAirport}</span></div>)}</div><div className="saved-trip-actions"><button type="button" className="button secondary" onClick={() => { selectTrip(value.id); setTab('plan'); }}>View plan <ArrowRight size={15}/></button><button type="button" className="icon-button" aria-label={`Edit ${value.name}`} onClick={() => editTrip(value)}><Pencil size={16}/></button><button type="button" className="icon-button danger-icon" aria-label={`Delete ${value.name}`} onClick={() => setDeleteTripId(value.id)}><Trash2 size={16}/></button></div></section>)}
            <button type="button" className="add-trip-card" onClick={createTrip}><span><Plus size={24}/></span><strong>Where to next?</strong><p>Build a plan around your next adventure.</p></button>
          </div><div className="manual-entry-note"><Info size={16}/><p>Flight details are entered manually. Use the local departure and arrival dates and times shown on your booking; Rephase accounts for airport time zones.</p></div>
        </>}

        {tab === 'profile' && <Profile {...props} onNotice={setNotice}/>}
        <footer className="page-footer"><span><Moon size={12}/>A better rhythm, wherever life takes you.</span><button type="button" onClick={() => setScienceOpen(true)}>Evidence & limitations <ArrowUpRight size={12}/></button></footer>
      </main>
    </div>
    <nav className="mobile-navigation" aria-label="Mobile navigation">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>
    {notice && <div className="toast" role="status"><CheckCircle2 size={17}/>{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15}/></button></div>}
    {scienceOpen && <ScienceModal onClose={() => setScienceOpen(false)}/>}
    {draftTrip && <TripEditor trip={draftTrip} setTrip={setDraftTrip} errors={tripErrors} onSave={saveTrip} onClose={() => setDraftTrip(null)} existing={data.trips.some(t => t.id === draftTrip.id)}/>}
    {deleteTripId && <Modal title="Delete this trip?" onClose={() => setDeleteTripId(null)} className="small-modal"><p className="modal-intro">The itinerary and its generated plan will be removed from this device.</p><div className="modal-footer"><button type="button" className="button secondary" onClick={() => setDeleteTripId(null)}>Keep trip</button><button type="button" className="button danger" onClick={removeTrip}><Trash2 size={15}/>Delete trip</button></div></Modal>}
    <datalist id="airport-codes">{AIRPORTS.map(airport => <option key={airport.code} value={airport.code}>{airport.city} · {airport.name}</option>)}</datalist>
    <datalist id="time-zones">{commonZones.map(zone => <option key={zone} value={zone}/>)}</datalist>
  </div>;
}

function EmptyPlan({ onCreate }: { onCreate: () => void }) {
  return <section className="empty-card large-empty"><span className="empty-orbit"><Moon size={35}/></span><h2>Your next journey starts here</h2><p>Add your flights and we’ll build a continuous plan for every stop.</p><button type="button" className="button primary" onClick={onCreate}><Plus size={16}/>Plan a trip</button></section>;
}

function Profile(props: AppProps & { onNotice: (message: string) => void }) {
  const { data, onChange, account, authConfig, syncStatus, onNotice } = props;
  const [preferences, setPreferences] = useState<Preferences>({ ...data.preferences });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [deleteCloud, setDeleteCloud] = useState(false);
  const [clearLocal, setClearLocal] = useState(false);
  const dirty = JSON.stringify(preferences) !== JSON.stringify(data.preferences);
  const duration = sleepSpan(preferences.preferredBedtime, preferences.preferredWakeTime);
  const conflicting = Math.abs(duration - preferences.sleepHours) > 0.1;
  useEffect(() => { setPreferences({ ...data.preferences }); }, [data.preferences]);
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
    try { await action(); } catch (error) { setAuthError(error instanceof Error ? error.message : 'The account action could not be completed. Please try again.'); } finally { setBusy(null); }
  }
  return <><div className="page-heading"><div><span className="eyebrow muted">Personal by design</span><h1>Your natural rhythm</h1><p>A better travel plan starts with how you sleep at home.</p></div><span className="profile-heading-icon"><UserRound size={24}/></span></div>
    <div className="profile-layout"><form className="preferences-form" onSubmit={save}>
      {errors.length > 0 && <div className="alert error-alert" role="alert"><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
      <section className="form-section"><div className="form-section-title"><span className="small-icon"><Globe2 size={19}/></span><div><h2>Home base</h2><p>Where your everyday body clock lives.</p></div></div><label className="field"><span>Home time zone</span><input list="time-zones" value={preferences.homeTimeZone} onChange={event => update('homeTimeZone', event.target.value)} required/><small>Use an IANA time zone, for example America/New_York.</small></label><fieldset className="chronotype-fieldset"><legend>Which sounds most like you?</legend><div className="chronotype-options">{([{ value: 'early', label: 'Early bird', detail: 'Mornings feel natural', icon: Sun }, { value: 'intermediate', label: 'In between', detail: 'Somewhere in the middle', icon: Clock3 }, { value: 'late', label: 'Night owl', detail: 'Evenings are my time', icon: Moon }, { value: 'unsure', label: 'Not sure', detail: 'Use my usual sleep times', icon: Sparkles }] as const).map(({ value, label, detail, icon: Icon }) => <label className={`chronotype-option ${preferences.chronotype === value ? 'chosen' : ''}`} key={value}><input type="radio" name="chronotype" value={value} checked={preferences.chronotype === value} onChange={() => update('chronotype', value)}/><Icon size={22}/><strong>{label}</strong><small>{detail}</small>{preferences.chronotype === value && <Check size={14} className="choice-check"/>}</label>)}</div></fieldset></section>
      <section className="form-section"><div className="form-section-title"><span className="small-icon"><Moon size={19}/></span><div><h2>Your sleep, your way</h2><p>Your usual schedule estimates your starting body clock.</p></div></div><div className="field-grid"><label className="field"><span>Usual bedtime</span><input type="time" value={preferences.usualBedtime} onChange={event => update('usualBedtime', event.target.value)} required/></label><label className="field"><span>Usual wake time</span><input type="time" value={preferences.usualWakeTime} onChange={event => update('usualWakeTime', event.target.value)} required/></label></div><div className="field-grid"><label className="field"><span>Preferred travel bedtime</span><input type="time" value={preferences.preferredBedtime} onChange={event => update('preferredBedtime', event.target.value)} required/></label><label className="field"><span>Preferred travel wake time</span><input type="time" value={preferences.preferredWakeTime} onChange={event => update('preferredWakeTime', event.target.value)} required/></label></div><div className="field-grid"><label className="field"><span>Hours of sleep you need</span><div className="input-with-unit"><input type="number" min="4" max="12" step="0.5" value={preferences.sleepHours} onChange={event => update('sleepHours', Number(event.target.value))} required/><span>hours</span></div></label><label className="field"><span>Keep this preference fixed</span><select value={preferences.sleepAnchor} onChange={event => update('sleepAnchor', event.target.value as 'wake' | 'bed')}><option value="wake">Wake time — adjust bedtime</option><option value="bed">Bedtime — adjust wake time</option></select></label></div>{conflicting && <div className="inline-note"><Info size={16}/><p>Your preferred times allow {duration} hours. The plan will preserve your {preferences.sleepAnchor === 'wake' ? 'wake time' : 'bedtime'} and adjust the other time to provide {preferences.sleepHours} hours.</p></div>}</section>
      <section className="form-section"><div className="form-section-title"><span className="small-icon"><Sparkles size={19}/></span><div><h2>Your planning preferences</h2><p>Choose the tools that feel right for you.</p></div></div><Toggle checked={preferences.caffeine} onChange={value => update('caffeine', value)} icon={Coffee} title="Include caffeine windows" description="Optional timing guidance for coffee, tea, and other caffeine."/><Toggle checked={preferences.melatonin} onChange={value => update('melatonin', value)} icon={Sparkles} title="Include melatonin guidance" description="Optional timing windows and an informational 0.5–1 mg range."/>
        {preferences.melatonin && <div className="melatonin-info"><h3>Before including melatonin</h3><p>Timing matters. Melatonin can cause drowsiness, interact with medicines, and vary in quality. Check suitability with a clinician, especially if pregnant, breastfeeding, taking medicines, or managing a health condition. Guidance is for adults and is not a personal prescription.</p><a href="https://www.nccih.nih.gov/health/melatonin-what-you-need-to-know" target="_blank" rel="noreferrer">Read NCCIH guidance <ExternalLink size={12}/></a><label className="checkbox-label"><input type="checkbox" checked={preferences.melatoninAcknowledged} onChange={event => update('melatoninAcknowledged', event.target.checked)} required={preferences.melatonin}/><span>I have reviewed this information and will check whether melatonin is suitable for me.</span></label></div>}
        <label className="field preparation-field"><span>Start preparing before departure</span><select value={preferences.preparationDays} onChange={event => update('preparationDays', Number(event.target.value))}><option value="0">On departure day</option><option value="1">1 day before</option><option value="2">2 days before</option><option value="3">3 days before</option></select><small>More preparation time can make the first travel day easier.</small></label>
      </section><div className="preferences-save"><span>{dirty ? 'You have unsaved changes' : 'Preferences saved on this device'}</span><button type="submit" className="button primary" disabled={!dirty}><Check size={16}/>Save preferences</button></div>
    </form><aside className="profile-aside"><section className="account-card"><span className="eyebrow muted"><ShieldCheck size={14}/>Your account</span><h2>{account ? `Hello, ${account.name.split(' ')[0]}` : 'Take your rhythm with you'}</h2><p>{account ? account.email : 'Use Google to access your account. Your plan also works without signing in.'}</p>{authError && <div className="inline-error" role="alert">{authError}</div>}{!account ? <><button type="button" className="google-button" disabled={!authConfig.googleClientId || Boolean(busy)} onClick={() => authAction('signin', props.onSignIn)}>{busy === 'signin' ? <LoaderCircle size={17} className="spin"/> : <GoogleMark/>}Continue with Google</button>{!authConfig.googleClientId && <p className="small-copy auth-config-note">Google sign-in needs a client ID configured for this deployment.</p>}</> : <><div className="account-sync-state"><Cloud size={17}/><span>{syncStatus || 'Signed in with Google'}</span></div>{authConfig.syncAvailable && <button type="button" className="button secondary full-width" disabled={Boolean(busy)} onClick={() => authAction('sync', props.onSync)}>{busy === 'sync' ? <LoaderCircle size={15} className="spin"/> : <Cloud size={15}/>}Sync my data</button>}<button type="button" className="text-button sign-out" disabled={Boolean(busy)} onClick={() => authAction('signout', props.onSignOut)}><LogOut size={14}/>Sign out</button></>}</section><section className="privacy-card"><span className="small-icon"><ShieldCheck size={20}/></span><h3>Designed to travel light</h3><p>Trips and plans stay in this browser. {authConfig.syncAvailable ? 'When you sign in, your trips and preferences can sync to your account.' : 'Cloud sync is not enabled for this deployment.'}</p><p className="small-copy">Your saved plan stays available offline after the app has loaded. Keep a calendar or data export for a backup.</p><button type="button" className="button secondary full-width" onClick={() => exportData(data)}><Download size={15}/>Export your data</button><button type="button" className="text-button danger-text cloud-delete-button" disabled={Boolean(busy)} onClick={() => setClearLocal(true)}><Trash2 size={13}/>Clear data on this device</button>{account && authConfig.syncAvailable && <button type="button" className="text-button danger-text cloud-delete-button" disabled={Boolean(busy)} onClick={() => setDeleteCloud(true)}><Trash2 size={13}/>Delete cloud data</button>}</section></aside></div>
    {clearLocal && <Modal title="Clear data on this device?" className="small-modal" onClose={() => setClearLocal(false)}><p className="modal-intro">This deletes locally saved trips, sleep preferences, and your cached plans. Cloud data remains saved in your account. Export your data first if you want a backup.</p><div className="modal-footer"><button type="button" className="button secondary" onClick={() => setClearLocal(false)}>Keep my data</button><button type="button" className="button danger" disabled={Boolean(busy)} onClick={async () => { await authAction('clear', props.onClearLocal); setClearLocal(false); }}>{busy === 'clear' && <LoaderCircle size={15} className="spin"/>}Clear local data</button></div></Modal>}
    {deleteCloud && <Modal title="Delete cloud data?" className="small-modal" onClose={() => setDeleteCloud(false)}><p className="modal-intro">This removes all synced trips and preferences from your Google-linked account. Your trips and preferences on this device remain available.</p><div className="modal-footer"><button type="button" className="button secondary" onClick={() => setDeleteCloud(false)}>Cancel</button><button type="button" className="button danger" disabled={Boolean(busy)} onClick={async () => { await authAction('delete', props.onDeleteCloud); setDeleteCloud(false); }}>{busy === 'delete' && <LoaderCircle size={15} className="spin"/>}Delete cloud data</button></div></Modal>}
  </>;
}

function GoogleMark() { return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.31 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.93A6 6 0 0 1 6.09 12c0-.67.11-1.32.31-1.93V7.48H3.05A10 10 0 0 0 2 12c0 1.61.38 3.13 1.05 4.52l3.35-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.78.5 3.82 1.49l2.86-2.86A9.56 9.56 0 0 0 12 2a10 10 0 0 0-8.95 5.48l3.35 2.59C7.19 7.71 9.4 5.95 12 5.95Z"/></svg>; }
function Toggle({ checked, onChange, icon: Icon, title, description }: { checked: boolean; onChange: (v: boolean) => void; icon: typeof Sun; title: string; description: string }) {
  return <label className="toggle-row"><span className="toggle-icon"><Icon size={20}/></span><span className="toggle-copy"><strong>{title}</strong><small>{description}</small></span><span className={`toggle ${checked ? 'on' : ''}`}><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/><span/></span></label>;
}

function TripEditor({ trip, setTrip, errors, onSave, onClose, existing }: { trip: Trip; setTrip: (value: Trip) => void; errors: string[]; onSave: () => void; onClose: () => void; existing: boolean }) {
  function updateLeg(id: string, patch: Partial<FlightLeg>) { setTrip({ ...trip, legs: trip.legs.map(leg => leg.id === id ? { ...leg, ...patch } : leg) }); }
  function updateAirport(leg: FlightLeg, side: 'departure' | 'arrival', value: string) {
    const code = value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
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
  return <Modal title={existing ? 'Edit your journey' : 'Plan a new journey'} onClose={onClose} className="trip-editor-modal">
    <p className="modal-intro">Add flights in travel order. Mark airport connections separately from places you’ll stay.</p><form onSubmit={event => { event.preventDefault(); onSave(); }}>
      <label className="field trip-name-field"><span>Trip name</span><input value={trip.name} onChange={event => setTrip({ ...trip, name: event.target.value })} placeholder="Tokyo, with a stop in Singapore" maxLength={100} required data-initial-focus/></label>
      {errors.length > 0 && <div className="alert error-alert" role="alert"><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
      <div className="flight-editor-list">{trip.legs.map((leg, index) => <section className="flight-editor-card" key={leg.id}><div className="flight-editor-heading"><span className="flight-number-badge">{index + 1}</span><h3>Flight {index + 1}</h3><div className="flight-editor-tools"><button type="button" className="icon-button" aria-label={`Move flight ${index + 1} earlier`} disabled={index === 0} onClick={() => moveLeg(index, -1)}><ArrowUpRight size={15} className="move-up"/></button><button type="button" className="icon-button" aria-label={`Move flight ${index + 1} later`} disabled={index === trip.legs.length - 1} onClick={() => moveLeg(index, 1)}><ArrowDown size={15}/></button><button type="button" className="icon-button danger-icon" aria-label={`Remove flight ${index + 1}`} disabled={trip.legs.length === 1} onClick={() => setTrip({ ...trip, legs: trip.legs.filter(value => value.id !== leg.id) })}><Trash2 size={15}/></button></div></div>
        <label className="field flight-number-field"><span>Flight number <small>optional</small></span><input value={leg.flightNumber} onChange={event => updateLeg(leg.id, { flightNumber: event.target.value })} placeholder="e.g. BA 282" maxLength={20}/></label>
        <div className="flight-endpoints"><div><span className="endpoint-label"><span/>Departure</span><label className="field"><span>Airport code</span><input list="airport-codes" value={leg.departureAirport} onChange={event => updateAirport(leg, 'departure', event.target.value)} placeholder="LAX" maxLength={3} required autoComplete="off"/><small>{findAirport(leg.departureAirport)?.name ?? 'Enter the 3-letter airport code'}</small></label><label className="field"><span>Local departure date & time</span><input type="datetime-local" value={leg.departureDateTime} onChange={event => updateLeg(leg.id, { departureDateTime: event.target.value })} required/></label><label className="field timezone-field"><span>Departure time zone</span><input list="time-zones" value={leg.departureTimeZone} onChange={event => updateLeg(leg.id, { departureTimeZone: event.target.value })} required/></label></div>
          <div><span className="endpoint-label arrival"><span/>Arrival</span><label className="field"><span>Airport code</span><input list="airport-codes" value={leg.arrivalAirport} onChange={event => updateAirport(leg, 'arrival', event.target.value)} placeholder="LHR" maxLength={3} required autoComplete="off"/><small>{findAirport(leg.arrivalAirport)?.name ?? 'Enter the 3-letter airport code'}</small></label><label className="field"><span>Local arrival date & time</span><input type="datetime-local" value={leg.arrivalDateTime} onChange={event => updateLeg(leg.id, { arrivalDateTime: event.target.value })} required/></label><label className="field timezone-field"><span>Arrival time zone</span><input list="time-zones" value={leg.arrivalTimeZone} onChange={event => updateLeg(leg.id, { arrivalTimeZone: event.target.value })} required/></label></div></div>
        <div className="cabin-editor field-grid"><label className="field"><span>Travel class</span><select value={leg.travelClass ?? 'economy'} onChange={event=>updateLeg(leg.id,{travelClass:event.target.value as FlightLeg['travelClass']})}><option value="economy">Economy</option><option value="premium-economy">Premium economy</option><option value="business">Business</option><option value="first">First</option></select></label><label className="field"><span>Lie-flat bed available?</span><select value={leg.lieFlat ? 'yes' : 'no'} onChange={event=>updateLeg(leg.id,{lieFlat:event.target.value==='yes'})}><option value="no">No / unsure — seated rest</option><option value="yes">Yes — confirmed lie-flat bed</option></select><small>Confirm your actual seat. Business class can have an upright or reclining seat.</small></label></div>
        <div className="flight-rest-note"><Moon size={15}/><p>Rest windows exclude the first 30 minutes after takeoff and the final 60 minutes before landing. Crew instructions and seatbelt requirements take priority.</p></div>
        <div className="stay-editor"><label className="field"><span>After this flight</span><select value={leg.stayAfter} onChange={event => updateLeg(leg.id, { stayAfter: event.target.value as FlightLeg['stayAfter'] })}><option value="destination">I’m staying at this destination</option><option value="connection">Airport connection / in transit</option></select></label>{leg.stayAfter === 'destination' ? <label className="field"><span>Adjustment strategy for this stay</span><select value={leg.strategy} onChange={event => updateLeg(leg.id, { strategy: event.target.value as FlightLeg['strategy'] })}><option value="adapt">Adjust toward local time</option><option value="partial">Partial adjustment for a short stay</option><option value="home">Keep my home rhythm</option></select><small>{leg.strategy === 'partial' ? 'Useful when you have a short stay before another destination.' : leg.strategy === 'home' ? 'Preserve your home body clock while planning in local time.' : 'Shift gradually toward your preferred destination sleep schedule.'}</small></label> : <div className="connection-info"><Info size={16}/><p>Your body-clock estimate continues through this connection. Add the onward flight below.</p></div>}</div>
      </section>)}</div>
      <button type="button" className="add-flight-button" onClick={addLeg}><Plus size={17}/>Add the next flight or return leg</button>
      <div className="inline-note"><Globe2 size={16}/><p>Enter each airport’s local date and time exactly as shown on your booking. Time zones fill automatically for known airports and remain editable.</p></div>
      <div className="modal-footer sticky-footer"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">{existing ? 'Save & regenerate plan' : 'Create my plan'}<ArrowRight size={16}/></button></div>
    </form>
  </Modal>;
}

function Modal({ title, onClose, className = '', children }: { title: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef<HTMLElement>(null);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        const modal = dialogRef.current;
        const elements = modal?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    const timer = window.setTimeout(() => { const first = dialogRef.current?.querySelector<HTMLElement>('[data-initial-focus]') ?? dialogRef.current?.querySelector<HTMLElement>('button'); first?.focus(); }, 0);
    return () => { document.removeEventListener('keydown', handleKey); window.clearTimeout(timer); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></header>{children}</section></div>;
}

function ScienceModal({ onClose }: { onClose: () => void }) {
  return <Modal title="The science of a softer landing" onClose={onClose} className="science-modal"><div className="science-intro"><span className="science-intro-icon"><Sparkles size={27}/></span><p>Jet lag happens when your internal clock and the time around you fall out of step. Carefully timed light and sleep can help bring them closer together.</p></div><div className="science-principles"><article><Sun size={22}/><div><h3>Light sets the pace</h3><p>Light can move your body clock earlier or later depending on when it reaches you. That’s why your plan includes both light exposure and light avoidance.</p></div></article><article><Moon size={22}/><div><h3>Sleep protects the journey</h3><p>A consistent sleep opportunity supports alertness and recovery. Your plan combines your sleep needs with gradual adjustment across the full itinerary.</p></div></article><article><Coffee size={22}/><div><h3>Optional tools, carefully timed</h3><p>Caffeine may support alertness while affecting later sleep. Melatonin timing matters; optional guidance uses the CDC’s informational 0.5–1 mg range, without personalized dosing.</p></div></article></div><div className="science-limitations"><Info size={18}/><div><h3>What this plan can tell you</h3><p>Rephase uses evidence-informed planning rules. Circadian phase and adjustment are estimates from your usual sleep schedule, rather than measurements. The app has not been clinically validated and does not reproduce Timeshifter’s proprietary algorithm.</p><p>Flight schedules, daylight exposure, actual sleep, health conditions, and individual responses can change the outcome. Review plan notes, and use professional advice for medical decisions.</p></div></div><h3 className="source-heading">Read the evidence</h3><div className="source-links"><a href="https://www.cdc.gov/yellow-book/hcp/travel-air-sea/jet-lag-disorder.html" target="_blank" rel="noreferrer"><span><strong>CDC Yellow Book</strong><small>Jet lag disorder: light, sleep, caffeine, and melatonin</small></span><ArrowUpRight size={18}/></a><a href="https://www.nccih.nih.gov/health/melatonin-what-you-need-to-know" target="_blank" rel="noreferrer"><span><strong>NCCIH · Melatonin</strong><small>Evidence, suitability, interactions, and product quality</small></span><ArrowUpRight size={18}/></a></div><div className="modal-footer"><button type="button" className="button primary" onClick={onClose}>Back to my rhythm <ArrowRight size={16}/></button></div></Modal>;
}
