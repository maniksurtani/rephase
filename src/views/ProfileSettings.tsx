import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  Clock3,
  Coffee,
  Download,
  Globe2,
  Info,
  LoaderCircle,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import type { AppProps } from '../app-types';
import type { Preferences } from '../lib/types';
import { exportData } from '../lib/export';
import { sleepSpan } from '../lib/display';
import { TimeZoneInput } from '../components/TimeZoneInput';
import { LoungeMembershipSettings } from '../components/LoungeMembershipSettings';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { Modal } from '../components/Modal';

export function ProfileSettings(props: AppProps & { onNotice: (message: string) => void }) {
  const { data, onChange, account, authConfig, saveStatus, onNotice } = props;
  const [preferences, setPreferences] = useState<Preferences>({ ...data.preferences });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [deleteCloud, setDeleteCloud] = useState(false);
  const [clearLocal, setClearLocal] = useState(false);
  const committedPreferences = useRef({
    accountId: account?.id ?? null,
    preferences: data.preferences,
  });
  const dirty = JSON.stringify(preferences) !== JSON.stringify(data.preferences);
  const duration = sleepSpan(preferences.preferredBedtime, preferences.preferredWakeTime);
  const conflicting = Math.abs(duration - preferences.sleepHours) > 0.1;
  useEffect(() => {
    const accountId = account?.id ?? null;
    const previous = committedPreferences.current;
    committedPreferences.current = { accountId, preferences: data.preferences };
    if (previous.accountId !== accountId) {
      setPreferences({ ...data.preferences });
      setErrors([]);
      setAuthError(null);
      setDeleteCloud(false);
      setClearLocal(false);
      return;
    }
    // A background account refresh updates untouched fields without discarding
    // edits that have not yet been submitted with Save preferences.
    setPreferences((draft) => {
      const next = { ...data.preferences };
      const preserveEdit = <K extends keyof Preferences>(key: K) => {
        if (!Object.is(draft[key], previous.preferences[key])) next[key] = draft[key];
      };
      (Object.keys(draft) as (keyof Preferences)[]).forEach(preserveEdit);
      return next;
    });
  }, [account?.id, data.preferences]);
  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((p) => ({ ...p, [key]: value }));
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: string[] = [];
    try {
      new Intl.DateTimeFormat('en', { timeZone: preferences.homeTimeZone }).format(new Date());
    } catch {
      nextErrors.push('Enter a valid home time zone, such as Europe/London.');
    }
    if (
      !Number.isFinite(preferences.sleepHours) ||
      preferences.sleepHours < 4 ||
      preferences.sleepHours > 12
    )
      nextErrors.push('Choose a sleep duration between 4 and 12 hours.');
    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }
    onChange({ ...data, preferences });
    setErrors([]);
    onNotice('Preferences saved.');
  }
  async function authAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    setAuthError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : 'The account action could not be completed. Please try again.',
      );
      return false;
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow muted">Personal by design</span>
          <h1>Your settings</h1>
          <p>Sleep, travel and lounge preferences, in one place.</p>
        </div>
      </div>
      <div className="profile-layout">
        <form className="preferences-form" onSubmit={save}>
          {errors.length > 0 && (
            <div className="alert error-alert" role="alert">
              <ul>
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          <section className="form-section">
            <div className="form-section-title">
              <span className="small-icon">
                <Globe2 size={19} />
              </span>
              <div>
                <h2>Home base</h2>
                <p>Where your everyday body clock lives.</p>
              </div>
            </div>
            <div className="field home-timezone-field">
              <label htmlFor="home-time-zone">Home time zone</label>
              <TimeZoneInput
                id="home-time-zone"
                value={preferences.homeTimeZone}
                onChange={(value) => update('homeTimeZone', value)}
                placeholder="Search a city or time zone"
                required
              />
              <small>Type a city or time zone.</small>
            </div>
            <fieldset className="chronotype-fieldset">
              <legend>Which sounds most like you?</legend>
              <div className="chronotype-options">
                {(
                  [
                    {
                      value: 'early',
                      label: 'Early bird',
                      detail: 'Mornings feel natural',
                      icon: Sun,
                    },
                    {
                      value: 'intermediate',
                      label: 'In between',
                      detail: 'Somewhere in the middle',
                      icon: Clock3,
                    },
                    {
                      value: 'late',
                      label: 'Night owl',
                      detail: 'Evenings are my time',
                      icon: Moon,
                    },
                    {
                      value: 'unsure',
                      label: 'Not sure',
                      detail: 'Use my usual sleep times',
                      icon: Sparkles,
                    },
                  ] as const
                ).map(({ value, label, detail, icon: Icon }) => (
                  <label
                    className={`chronotype-option ${preferences.chronotype === value ? 'chosen' : ''}`}
                    key={value}
                  >
                    <input
                      type="radio"
                      name="chronotype"
                      value={value}
                      checked={preferences.chronotype === value}
                      onChange={() => update('chronotype', value)}
                    />
                    <Icon size={22} />
                    <strong>{label}</strong>
                    <small>{detail}</small>
                    {preferences.chronotype === value && (
                      <Check size={14} className="choice-check" />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
          <section className="form-section">
            <div className="form-section-title">
              <span className="small-icon">
                <Moon size={19} />
              </span>
              <div>
                <h2>Your sleep, your way</h2>
                <p>Your usual schedule estimates your starting body clock.</p>
              </div>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Usual bedtime</span>
                <input
                  type="time"
                  value={preferences.usualBedtime}
                  onChange={(event) => update('usualBedtime', event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Usual wake time</span>
                <input
                  type="time"
                  value={preferences.usualWakeTime}
                  onChange={(event) => update('usualWakeTime', event.target.value)}
                  required
                />
              </label>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Preferred travel bedtime</span>
                <input
                  type="time"
                  value={preferences.preferredBedtime}
                  onChange={(event) => update('preferredBedtime', event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Preferred travel wake time</span>
                <input
                  type="time"
                  value={preferences.preferredWakeTime}
                  onChange={(event) => update('preferredWakeTime', event.target.value)}
                  required
                />
              </label>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Hours of sleep you need</span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min="4"
                    max="12"
                    step="0.5"
                    value={preferences.sleepHours}
                    onChange={(event) => update('sleepHours', Number(event.target.value))}
                    required
                  />
                  <span>hours</span>
                </div>
              </label>
              <label className="field">
                <span>Keep this preference fixed</span>
                <select
                  value={preferences.sleepAnchor}
                  onChange={(event) => update('sleepAnchor', event.target.value as 'wake' | 'bed')}
                >
                  <option value="wake">Wake time — adjust bedtime</option>
                  <option value="bed">Bedtime — adjust wake time</option>
                </select>
              </label>
            </div>
            {conflicting && (
              <div className="inline-note">
                <Info size={16} />
                <p>
                  Your preferred times allow {duration} hours. The plan will preserve your{' '}
                  {preferences.sleepAnchor === 'wake' ? 'wake time' : 'bedtime'} and adjust the
                  other time to provide {preferences.sleepHours} hours.
                </p>
              </div>
            )}
          </section>
          <section className="form-section">
            <div className="form-section-title">
              <span className="small-icon">
                <Sparkles size={19} />
              </span>
              <div>
                <h2>Your planning preferences</h2>
                <p>Choose the tools that feel right for you.</p>
              </div>
            </div>
            <Toggle
              checked={preferences.caffeine}
              onChange={(value) => update('caffeine', value)}
              icon={Coffee}
              title="Include caffeine windows"
              description="Optional timing guidance for coffee, tea, and other caffeine."
            />
            <Toggle
              checked={preferences.melatonin}
              onChange={(value) => update('melatonin', value)}
              icon={Sparkles}
              title="Include melatonin guidance"
              description="Optional timing windows and an informational 0.5–1 mg range."
            />
            <Toggle
              checked={preferences.calendarAlarms !== false}
              onChange={(value) => update('calendarAlarms', value)}
              icon={CalendarDays}
              title="Calendar reminders"
              description="Include reminders 10 minutes before actions in calendar exports."
            />
            <label className="field preparation-field">
              <span>Start preparing before departure</span>
              <select
                value={preferences.preparationDays}
                onChange={(event) => update('preparationDays', Number(event.target.value))}
              >
                <option value="0">On departure day</option>
                <option value="1">1 day before</option>
                <option value="2">2 days before</option>
                <option value="3">3 days before</option>
              </select>
              <small>More preparation time can make the first travel day easier.</small>
            </label>
          </section>
          <LoungeMembershipSettings
            key={account?.id ?? 'guest'}
            memberships={preferences.loungeMemberships ?? []}
            onChange={(memberships) => update('loungeMemberships', memberships)}
          />
          <div className="preferences-save">
            <span>
              {dirty
                ? 'You have unsaved changes'
                : account
                  ? saveStatus || 'Changes save to your account automatically'
                  : 'Preferences saved on this device'}
            </span>
            <button type="submit" className="button primary" disabled={!dirty}>
              <Check size={16} />
              Save preferences
            </button>
          </div>
        </form>
        <aside className={`profile-aside ${account ? 'has-account' : ''}`}>
          {!account && (
            <section className="account-card">
              <span className="eyebrow muted">
                <ShieldCheck size={14} />
                Your account
              </span>
              <h2>Take your rhythm with you</h2>
              <p>Save your preferences and trips to your Google-linked account.</p>
              {authConfig.googleClientId ? (
                <GoogleSignInButton
                  clientId={authConfig.googleClientId}
                  onSuccess={props.onGoogleSignIn}
                  onError={props.onSignInError}
                />
              ) : (
                <p className="small-copy auth-config-note">
                  Google sign-in is unavailable. You can still plan trips on this device.
                </p>
              )}
            </section>
          )}
          <section className="privacy-card">
            <span className="small-icon">
              <ShieldCheck size={20} />
            </span>
            <h3>{account ? 'Your plans, wherever you go' : 'Designed to travel light'}</h3>
            <p>
              {account
                ? 'Your preferences and trips save to your account automatically and are ready when you sign in on another device.'
                : 'Your preferences and trips stay on this device until you sign in.'}
            </p>
            <p className="small-copy">
              {account
                ? 'An offline copy keeps your plans available when you travel. Changes made offline save to your account when you reconnect.'
                : 'Your saved plan stays available offline after the app has loaded.'}{' '}
              You can export a backup at any time.
            </p>
            {authError && (
              <div className="inline-error" role="alert">
                {authError}
              </div>
            )}
            <button
              type="button"
              className="button secondary full-width"
              onClick={() => exportData(data)}
            >
              <Download size={15} />
              Export your data
            </button>
            <button
              type="button"
              className="text-button cloud-delete-button"
              disabled={Boolean(busy)}
              onClick={() => {
                setAuthError(null);
                setClearLocal(true);
              }}
            >
              <Trash2 size={13} />
              {account ? 'Clear offline copy' : 'Clear data on this device'}
            </button>
            {account && authConfig.syncAvailable && (
              <button
                type="button"
                className="text-button danger-text cloud-delete-button"
                disabled={Boolean(busy) || !props.accountReady}
                onClick={() => {
                  setAuthError(null);
                  setDeleteCloud(true);
                }}
              >
                <Trash2 size={13} />
                Delete saved account data
              </button>
            )}
          </section>
        </aside>
      </div>
      {clearLocal && (
        <Modal
          title={account ? 'Clear your offline copy?' : 'Clear data on this device?'}
          className="small-modal"
          onClose={() => setClearLocal(false)}
        >
          <p className="modal-intro">
            {account
              ? 'Your saved preferences and trips stay in your account. Rephase will reload them when you are online.'
              : 'This deletes trips, preferences, and cached plans saved on this device. Export your data first if you want a backup.'}
          </p>
          {authError && (
            <div className="inline-error" role="alert">
              {authError}
            </div>
          )}
          <div className="modal-footer">
            <button type="button" className="button secondary" onClick={() => setClearLocal(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="button danger"
              disabled={Boolean(busy)}
              onClick={async () => {
                if (await authAction('clear', props.onClearLocal)) setClearLocal(false);
              }}
            >
              {busy === 'clear' && <LoaderCircle size={15} className="spin" />}
              {account ? 'Clear offline copy' : 'Clear local data'}
            </button>
          </div>
        </Modal>
      )}
      {deleteCloud && (
        <Modal
          title="Delete saved account data?"
          className="small-modal"
          onClose={() => setDeleteCloud(false)}
        >
          <p className="modal-intro">
            This deletes your saved preferences, trips, and recorded history from your account and
            clears their offline copy on this device. This cannot be undone.
          </p>
          {authError && (
            <div className="inline-error" role="alert">
              {authError}
            </div>
          )}
          <div className="modal-footer">
            <button
              type="button"
              className="button secondary"
              onClick={() => setDeleteCloud(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button danger"
              disabled={Boolean(busy)}
              onClick={async () => {
                if (await authAction('delete', props.onDeleteAccountData)) setDeleteCloud(false);
              }}
            >
              {busy === 'delete' && <LoaderCircle size={15} className="spin" />}Delete account data
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Toggle({
  checked,
  onChange,
  icon: Icon,
  title,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: typeof Sun;
  title: string;
  description: string;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-icon">
        <Icon size={20} />
      </span>
      <span className="toggle-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className={`toggle ${checked ? 'on' : ''}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span />
      </span>
    </label>
  );
}
