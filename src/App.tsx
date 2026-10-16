import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdherenceRecord, PlanAction, PlanTravelSegment, Trip } from './lib/types';
import type { AppProps } from './app-types';
import { validateTrip } from './lib/itinerary';
import { createEmptyTrip } from './lib/defaults';
import {
  Armchair,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Info,
  LoaderCircle,
  Moon,
  Plane,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import './styles.css';
import './timeline.css';
import './lounges.css';
import { usePlanning } from './lib/usePlanning';
import { usePlanView } from './lib/usePlanView';
import { localDate } from './lib/display';
import { tripEditConflict } from './lib/trip-edit';
import { TripEditor } from './components/TripEditor';
import { Modal } from './components/Modal';
import { FlightSegmentCard } from './components/FlightSegmentCard';
import { LoungeExplorer } from './components/LoungeExplorer';
import { LoungeOpportunityLink } from './components/LoungeOpportunityLink';
import { buildFlightLoungeContexts, type LoungeFlightContext } from './lib/lounge-windows';
import { AdherenceForm } from './components/AdherenceForm';
import { validateAppData } from './lib/validation';
import { AccountAvatar, AccountMenu } from './components/AccountMenu';
import { ScienceModal } from './components/ScienceModal';
import { TodayView } from './views/TodayView';
import { PlanView } from './views/PlanView';
import { TripsView } from './views/TripsView';
import { ProfileSettings } from './views/ProfileSettings';

type Tab = 'today' | 'plan' | 'trips' | 'lounges' | 'profile';
const tabs: { id: Tab; label: string; icon: typeof Sun }[] = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'plan', label: 'Your plan', icon: CalendarDays },
  { id: 'trips', label: 'Trips', icon: Plane },
  { id: 'lounges', label: 'Lounges', icon: Armchair },
  { id: 'profile', label: 'Profile', icon: UserRound },
];
const commonZones = [
  'America/Los_Angeles',
  'America/New_York',
  'America/Chicago',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

export default function App(props: AppProps) {
  const { data, onChange, account, authConfig, saveStatus, storageError } = props;
  const [tab, setTab] = useState<Tab>('today');
  const [loungeContext, setLoungeContext] = useState<LoungeFlightContext | undefined>();
  const [profileSection, setProfileSection] = useState<'lounges' | null>(null);
  const [loungeSession, setLoungeSession] = useState(0);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [scienceOpen, setScienceOpen] = useState(false);
  const [draftTrip, setDraftTrip] = useState<Trip | null>(null);
  const [draftSession, setDraftSession] = useState(0);
  const draftBaseline = useRef<Trip | null>(null);
  const [tripConflict, setTripConflict] = useState<'changed' | 'deleted' | null>(null);
  const draftAccountId = useRef<string | null>(account?.id ?? null);
  const [tripErrors, setTripErrors] = useState<string[]>([]);
  const [deleteTripId, setDeleteTripId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const trip = data.trips.find((t) => t.id === data.selectedTripId) ?? data.trips[0] ?? null;
  const loungeOpportunities = useMemo(() => (trip ? buildFlightLoungeContexts(trip) : []), [trip]);
  const result = usePlanning(trip, data.preferences);
  const [recordAction, setRecordAction] = useState<PlanAction | null>(null);
  const plan = result.plan;
  const view = usePlanView(plan, trip, selectedDayId, now);
  const { selectedDay } = view;
  const showSaveStatus = Boolean(
    saveStatus &&
    ![
      'Saved on this device',
      'Saving on this device…',
      'Opening your device data…',
      'Device data cleared',
    ].includes(saveStatus),
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    // An editor opened for one identity must not save into a different account.
    draftBaseline.current = null;
    setTripConflict(null);
    setDraftTrip(null);
    setTripErrors([]);
    setDeleteTripId(null);
    setRecordAction(null);
    setSelectedDayId(null);
    setLoungeContext(undefined);
    setLoungeSession((value) => value + 1);
  }, [account?.id]);
  useEffect(() => {
    setSelectedDayId(null);
    setLoungeContext(undefined);
    setLoungeSession((value) => value + 1);
  }, [trip?.id]);
  useEffect(() => {
    if (!loungeContext) return;
    const current = loungeOpportunities.find((value) => value.id === loungeContext.id);
    if (JSON.stringify(current) !== JSON.stringify(loungeContext)) {
      setLoungeContext(current);
      setLoungeSession((value) => value + 1);
    }
  }, [loungeOpportunities, loungeContext]);
  useEffect(() => {
    if (tab !== 'profile' || profileSection !== 'lounges') return;
    const section = document.getElementById('lounge-membership-settings-title');
    section?.scrollIntoView({ block: 'start' });
    section?.focus({ preventScroll: true });
    setProfileSection(null);
  }, [tab, profileSection]);
  useEffect(() => {
    if (notice) {
      const timer = window.setTimeout(() => setNotice(null), 4500);
      return () => window.clearTimeout(timer);
    }
  }, [notice]);

  function exploreLounges(opportunity?: LoungeFlightContext) {
    setLoungeContext(opportunity);
    setLoungeSession((value) => value + 1);
    setTab('lounges');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function flightWithLounges(segment: PlanTravelSegment, inPlan = false) {
    const opportunity = loungeOpportunities.find((value) => value.legId === segment.id);
    const showOpportunity =
      opportunity &&
      (inPlan
        ? selectedDay?.date === localDate(segment.departure, segment.departureTimeZone)
        : now.getTime() < Date.parse(opportunity.departure));
    return (
      <>
        {showOpportunity && (
          <LoungeOpportunityLink opportunity={opportunity} onExplore={exploreLounges} />
        )}
        <FlightSegmentCard segment={segment} collapseMeals={inPlan} />
      </>
    );
  }

  function editTrip(value: Trip) {
    draftAccountId.current = account?.id ?? null;
    draftBaseline.current = structuredClone(value);
    setDraftSession((value) => value + 1);
    setDraftTrip(structuredClone(value));
    setTripErrors([]);
    setTripConflict(null);
  }
  function createTrip() {
    draftAccountId.current = account?.id ?? null;
    draftBaseline.current = null;
    setDraftSession((value) => value + 1);
    setDraftTrip(createEmptyTrip());
    setTripErrors([]);
    setTripConflict(null);
  }
  function selectTrip(id: string) {
    onChange({ ...data, selectedTripId: id });
    setSelectedDayId(null);
  }
  function saveTrip() {
    if (!draftTrip) return;
    if (draftAccountId.current !== (account?.id ?? null)) {
      setDraftTrip(null);
      return;
    }
    const conflict = tripEditConflict(
      draftBaseline.current,
      data.trips.find((value) => value.id === draftTrip.id),
    );
    if (conflict) {
      setTripConflict(conflict);
      setTripErrors([
        conflict === 'changed'
          ? 'This trip changed on another device while you were editing. Reload the latest trip before saving; your unsaved edits will be replaced.'
          : 'This trip was deleted on another device. Close this editor to review your current trips.',
      ]);
      return;
    }
    const errors = validateTrip(draftTrip);
    if (!draftTrip.name.trim()) errors.unshift('Give your trip a name.');
    if (errors.length) {
      setTripErrors(errors);
      return;
    }
    const saved = {
      ...draftTrip,
      id: draftTrip.id.startsWith('demo-') ? crypto.randomUUID() : draftTrip.id,
      name: draftTrip.name.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (saved.adherence)
      saved.adherence = saved.adherence.map((entry) => ({ ...entry, tripId: saved.id }));
    const candidate = {
      ...data,
      trips: data.trips.some((t) => t.id === draftTrip.id)
        ? data.trips.map((t) => (t.id === draftTrip.id ? saved : t))
        : [...data.trips, saved],
      selectedTripId: saved.id,
    };
    const formatError = validateAppData(candidate);
    if (formatError) {
      setTripErrors([formatError]);
      return;
    }
    onChange(candidate);
    setDraftTrip(null);
    setTab('plan');
    setNotice('Trip saved. Your full itinerary plan is ready.');
  }
  function saveRecord(record: AdherenceRecord) {
    if (!trip) return;
    const updated = {
      ...trip,
      adherence: [
        ...(trip.adherence ?? []).filter((entry) => entry.actionId !== record.actionId),
        record,
      ],
      updatedAt: new Date().toISOString(),
    };
    onChange({
      ...data,
      trips: data.trips.map((value) => (value.id === trip.id ? updated : value)),
    });
    setRecordAction(null);
    setNotice('Record saved. Future recommendations are being updated.');
  }
  function removeTrip() {
    const remaining = data.trips.filter((t) => t.id !== deleteTripId);
    onChange({
      ...data,
      trips: remaining,
      selectedTripId:
        data.selectedTripId === deleteTripId ? (remaining[0]?.id ?? null) : data.selectedTripId,
    });
    setDeleteTripId(null);
    setNotice('Trip deleted.');
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            setTab('today');
          }}
          aria-label="Rephase home"
        >
          <span className="brand-mark">
            <Moon size={21} />
          </span>
          <span>
            rephase<span className="brand-dot">.</span>
          </span>
        </a>
        <p className="sidebar-caption">Find your travel rhythm</p>
        <nav className="main-navigation" aria-label="Main navigation">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={`nav-item ${tab === id ? 'active' : ''}`}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {tab === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="science-teaser">
            <div className="science-orbit">
              <Sparkles size={18} />
            </div>
            <p>
              A little science.
              <br />A better arrival.
            </p>
            <button type="button" onClick={() => setScienceOpen(true)}>
              The science behind Rephase <ArrowUpRight size={14} />
            </button>
          </div>
          <button type="button" className="account-shortcut" onClick={() => setTab('profile')}>
            <span className="avatar">
              <AccountAvatar account={account} />
            </span>
            <span>
              <strong>{account?.name ?? 'Your profile'}</strong>
              <small>{account ? 'Settings' : 'Saved on this device'}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <Moon size={21} />
            <span>rephase.</span>
          </div>
          <span className="topbar-label">
            {tab === 'today'
              ? 'Your rhythm, wherever you go'
              : tabs.find((t) => t.id === tab)?.label}
          </span>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Learn about the science"
              onClick={() => setScienceOpen(true)}
            >
              <Info size={19} />
            </button>
            <AccountMenu
              account={account}
              accountReady={props.accountReady}
              clientId={authConfig.googleClientId}
              onProfile={() => setTab('profile')}
              onGoogleSignIn={props.onGoogleSignIn}
              onSignInError={props.onSignInError}
              onSignOut={props.onSignOut}
            />
          </div>
        </header>
        <main id="main-content" className={`main-content page-${tab}`} tabIndex={-1}>
          {storageError && (
            <div className="alert error-alert" role="alert">
              <Info size={17} />
              <span>{storageError}</span>
            </div>
          )}
          {showSaveStatus && (
            <div className="account-save-status" role="status">
              {saveStatus}
            </div>
          )}
          {result.loading && (
            <div className="alert" role="status">
              <LoaderCircle size={17} className="spin" />
              <span>Finding a practical light and sleep plan for your whole journey…</span>
            </div>
          )}
          {result.error && (
            <div className="alert error-alert">
              <Info size={17} />
              <span>{result.error}</span>
              {trip && (
                <button type="button" onClick={() => editTrip(trip)}>
                  Edit trip
                </button>
              )}
            </div>
          )}
          {tab === 'today' && (
            <TodayView
              trip={trip}
              preferences={data.preferences}
              plan={plan}
              view={view}
              onViewPlan={() => setTab('plan')}
              onViewTrips={() => setTab('trips')}
              onPreferences={() => setTab('profile')}
              onCreateTrip={createTrip}
              renderFlight={flightWithLounges}
            />
          )}

          {tab === 'plan' && (
            <PlanView
              trip={trip}
              plan={plan}
              view={view}
              loading={result.loading}
              calendarAlarms={data.preferences.calendarAlarms !== false}
              onCreateTrip={createTrip}
              onEditTrip={editTrip}
              onSelectDay={setSelectedDayId}
              onScience={() => setScienceOpen(true)}
              onRecord={setRecordAction}
              renderFlight={flightWithLounges}
            />
          )}

          {tab === 'trips' && (
            <TripsView
              trips={data.trips}
              selectedTripId={trip?.id}
              onCreateTrip={createTrip}
              onViewPlan={(id) => {
                selectTrip(id);
                setTab('plan');
              }}
              onEditTrip={editTrip}
              onDeleteTrip={setDeleteTripId}
            />
          )}

          {tab === 'lounges' && (
            <LoungeExplorer
              key={`${account?.id ?? 'guest'}:${loungeSession}`}
              preferences={data.preferences}
              onPreferences={(preferences) => onChange({ ...data, preferences })}
              opportunity={loungeContext}
              onEditMemberships={() => {
                setProfileSection('lounges');
                setTab('profile');
              }}
              onClearContext={() => exploreLounges()}
            />
          )}
          {tab === 'profile' && <ProfileSettings {...props} onNotice={setNotice} />}
          <footer className="page-footer">
            <span>
              <Moon size={12} />A better rhythm, wherever life takes you.
            </span>
            <div className="footer-links">
              <a href="/science.html">
                Science & further reading <ArrowUpRight size={12} />
              </a>
              <a href="https://aerodatabox.com/" target="_blank" rel="noopener">
                Flight data by AeroDataBox <ExternalLink size={12} />
              </a>
            </div>
          </footer>
        </main>
      </div>
      <nav className="mobile-navigation" aria-label="Mobile navigation">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={tab === id ? 'active' : ''}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {scienceOpen && <ScienceModal onClose={() => setScienceOpen(false)} />}
      {draftTrip && (
        <TripEditor
          key={draftSession}
          trip={draftTrip}
          setTrip={setDraftTrip}
          errors={tripErrors}
          onSave={saveTrip}
          onClose={() => setDraftTrip(null)}
          existing={Boolean(draftBaseline.current)}
          onReload={
            tripConflict === 'changed'
              ? () => {
                  const latest = data.trips.find((value) => value.id === draftTrip.id);
                  if (latest) editTrip(latest);
                }
              : undefined
          }
          accountId={account?.id ?? null}
          flightLookupAvailable={Boolean(authConfig.flightLookupAvailable)}
        />
      )}
      {deleteTripId && (
        <Modal
          title="Delete this trip?"
          onClose={() => setDeleteTripId(null)}
          className="small-modal"
        >
          <p className="modal-intro">
            The itinerary, recorded history, and imported flight details will be removed
            {account ? ' from your account' : ' from this device'}. This cannot be undone.
          </p>
          <div className="modal-footer">
            <button
              type="button"
              className="button secondary"
              onClick={() => setDeleteTripId(null)}
            >
              Keep trip
            </button>
            <button type="button" className="button danger" onClick={removeTrip}>
              <Trash2 size={15} />
              Delete trip
            </button>
          </div>
        </Modal>
      )}
      {recordAction && trip && (
        <Modal
          title="Record your actual experience"
          onClose={() => setRecordAction(null)}
          className="small-modal"
        >
          <AdherenceForm
            action={recordAction}
            tripId={trip.id}
            existing={trip.adherence?.find((entry) => entry.actionId === recordAction.id)}
            onSave={saveRecord}
            onClose={() => setRecordAction(null)}
          />
        </Modal>
      )}
      <datalist id="time-zones">
        {commonZones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
    </div>
  );
}
