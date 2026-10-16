import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Armchair, Plus, Search, X } from 'lucide-react';
import { LOUNGE_MEMBERSHIPS, type LoungeMembership } from '../lib/lounge-types';
import { LOYALTY_PROGRAMS, searchLoyaltyPrograms } from '../lib/lounge-programs';
import './lounge-memberships.css';

interface Props {
  memberships: LoungeMembership[];
  onChange: (memberships: LoungeMembership[]) => void;
}

const paidMemberships = new Set([
  'priority-pass',
  'qantas-club',
  'united-club',
  'alaska-lounge-plus',
  'admirals-club',
]);
type LoyaltyProgram = (typeof LOYALTY_PROGRAMS)[number];
const alliances = [
  {
    id: 'oneworld',
    name: 'oneworld',
    tiers: ['oneworld-ruby', 'oneworld-sapphire', 'oneworld-emerald'],
  },
  { id: 'star', name: 'Star Alliance', tiers: ['star-silver', 'star-gold'] },
  { id: 'skyteam', name: 'SkyTeam', tiers: ['skyteam-elite', 'skyteam-elite-plus'] },
] as const;

export function LoungeMembershipSettings({ memberships, onChange }: Props) {
  const id = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const statusInputs = useRef(new Map<string, HTMLSelectElement>());
  const pendingFocus = useRef<string | null>(null);

  const selectedPrograms = LOYALTY_PROGRAMS.flatMap((program) => {
    // Old copies can contain multiple levels. Display the highest without changing saved data.
    const tier = [...program.tiers].reverse().find((value) => memberships.includes(value.id));
    return tier ? [{ program, tier }] : [];
  });
  const availablePrograms = searchLoyaltyPrograms(query).filter(
    (program) => !selectedPrograms.some((value) => value.program.id === program.id),
  );

  useEffect(() => {
    if (pickerOpen) searchInput.current?.focus();
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen && pendingFocus.current) {
      const target = statusInputs.current.get(pendingFocus.current);
      if (target) {
        target.focus();
        pendingFocus.current = null;
      }
    }
  }, [pickerOpen, memberships]);

  function replaceProgram(program: LoyaltyProgram, tierId?: LoungeMembership) {
    const remaining = memberships.filter(
      (value) => !program.tiers.some((tier) => tier.id === value),
    );
    onChange(tierId ? [...remaining, tierId] : remaining);
  }

  function addProgram(program: LoyaltyProgram) {
    const initialTier = program.tiers[0];
    if (!initialTier) return;
    pendingFocus.current = program.id;
    replaceProgram(program, initialTier.id);
    setPickerOpen(false);
    setQuery('');
  }

  function closePicker() {
    setPickerOpen(false);
    setQuery('');
    addButton.current?.focus();
  }

  function pickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
      return;
    }
    const buttons = Array.from(
      picker.current?.querySelectorAll<HTMLButtonElement>('.loyalty-program-result') ?? [],
    );
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (
      event.target === searchInput.current &&
      (event.key === 'ArrowDown' || event.key === 'Enter')
    ) {
      event.preventDefault();
      buttons[0]?.focus();
    } else if (index >= 0 && event.key === 'ArrowDown') {
      event.preventDefault();
      buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
    } else if (index >= 0 && event.key === 'ArrowUp') {
      event.preventDefault();
      if (index === 0) searchInput.current?.focus();
      else buttons[index - 1]?.focus();
    }
  }

  function toggleMembership(membershipId: LoungeMembership, checked: boolean) {
    onChange(
      checked
        ? [...memberships.filter((value) => value !== membershipId), membershipId]
        : memberships.filter((value) => value !== membershipId),
    );
  }

  return (
    <section
      className="form-section lounge-membership-settings"
      aria-labelledby="lounge-membership-settings-title"
    >
      <div className="form-section-title">
        <span className="small-icon">
          <Armchair size={19} />
        </span>
        <div>
          <h2 id="lounge-membership-settings-title" tabIndex={-1}>
            Lounge memberships & airline status
          </h2>
          <p>Save the programs you use to find lounges you can access.</p>
        </div>
      </div>

      <div className="loyalty-status-settings" aria-labelledby={`${id}-airline-status`}>
        <h3 id={`${id}-airline-status`}>Airline status</h3>
        {selectedPrograms.length > 0 ? (
          <div className="loyalty-status-list">
            {selectedPrograms.map(({ program, tier }) => (
              <div className="loyalty-status-row" key={program.id} data-program={program.id}>
                <div className="loyalty-program-heading">
                  <strong>{program.name}</strong>
                  <span>{program.airline}</span>
                  {tier.allianceTier && (
                    <span className="loyalty-alliance-badge">
                      {LOUNGE_MEMBERSHIPS.find((value) => value.id === tier.allianceTier)?.label ??
                        tier.allianceTier}
                    </span>
                  )}
                </div>
                <label className="loyalty-status-field">
                  <span className="sr-only">{program.name} status</span>
                  <select
                    ref={(element) => {
                      if (element) statusInputs.current.set(program.id, element);
                      else statusInputs.current.delete(program.id);
                    }}
                    value={tier.id}
                    onChange={(event) => {
                      const nextTier = program.tiers.find(
                        (value) => value.id === event.target.value,
                      );
                      if (nextTier) replaceProgram(program, nextTier.id);
                    }}
                  >
                    {program.tiers.map((value) => (
                      <option key={value.id} value={value.id}>
                        {value.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="loyalty-remove-button"
                  aria-label={`Remove ${program.name}`}
                  onClick={() => {
                    replaceProgram(program);
                    addButton.current?.focus();
                  }}
                >
                  <X size={17} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="loyalty-empty-note">Add a program, then choose your status.</p>
        )}

        <button
          ref={addButton}
          type="button"
          className="button secondary loyalty-add-button"
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? `${id}-program-picker` : undefined}
          onClick={() => {
            setQuery('');
            setPickerOpen(true);
          }}
        >
          <Plus size={16} />
          Add airline status
        </button>
        {pickerOpen && (
          <div
            className="loyalty-program-picker"
            id={`${id}-program-picker`}
            ref={picker}
            role="group"
            aria-label="Add an airline status"
            onKeyDown={pickerKeyDown}
          >
            <div className="loyalty-picker-heading">
              <label htmlFor={`${id}-program-search`}>Search airline programs</label>
              <button type="button" className="text-button" onClick={closePicker}>
                Cancel
              </button>
            </div>
            <div className="loyalty-search-field">
              <Search size={17} aria-hidden="true" />
              <input
                ref={searchInput}
                id={`${id}-program-search`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Airline or program name"
                autoComplete="off"
              />
            </div>
            <p className="sr-only" role="status">
              {availablePrograms.length} matching{' '}
              {availablePrograms.length === 1 ? 'program' : 'programs'}
            </p>
            {availablePrograms.length > 0 ? (
              <ul className="loyalty-program-results">
                {availablePrograms.map((program) => (
                  <li key={program.id}>
                    <button
                      type="button"
                      className="loyalty-program-result"
                      aria-label={`Add ${program.name}`}
                      onClick={() => addProgram(program)}
                    >
                      <span>
                        <strong>{program.name}</strong>
                        <small>{program.airline}</small>
                      </span>
                      <Plus size={17} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="loyalty-no-results">
                No matching programs. Try the airline or program name.
              </p>
            )}
          </div>
        )}
      </div>

      <fieldset className="lounge-programs lounge-paid-memberships">
        <legend>Lounge memberships</legend>
        {LOUNGE_MEMBERSHIPS.filter((program) => paidMemberships.has(program.id)).map((program) => (
          <label key={program.id}>
            <input
              type="checkbox"
              checked={memberships.includes(program.id)}
              onChange={(event) => toggleMembership(program.id, event.target.checked)}
            />
            <span>{program.label}</span>
          </label>
        ))}
      </fieldset>

      <details className="loyalty-alliance-settings">
        <summary>Alliance status</summary>
        <p>Use this if your airline program isn’t listed above.</p>
        <div className="loyalty-alliance-fields">
          {alliances.map((alliance) => {
            const tiers = alliance.tiers.flatMap((tierId) => {
              const tier = LOUNGE_MEMBERSHIPS.find((program) => program.id === tierId);
              return tier ? [tier] : [];
            });
            const selected = [...tiers].reverse().find((tier) => memberships.includes(tier.id));
            return (
              <label className="loyalty-status-field" key={alliance.id}>
                <span>{alliance.name} status</span>
                <select
                  value={selected?.id ?? ''}
                  onChange={(event) => {
                    const tier = tiers.find((value) => value.id === event.target.value);
                    const remaining = memberships.filter(
                      (value) => !tiers.some((valueTier) => valueTier.id === value),
                    );
                    onChange(tier ? [...remaining, tier.id] : remaining);
                  }}
                >
                  <option value="">Not specified</option>
                  {tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </details>
    </section>
  );
}
