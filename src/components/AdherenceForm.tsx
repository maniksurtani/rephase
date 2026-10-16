import { useState } from 'react';
import { localToInstant, dateInZone, formatTime } from '../lib/time';
import type { AdherenceRecord, PlanAction } from '../lib/types';
import { FoldChoice } from './FoldChoice';
const clock = (iso: string, zone: string) => `${dateInZone(iso, zone)}T${formatTime(iso, zone)}`;
function occurrence(iso: string, zone: string): 'earlier' | 'later' | undefined {
  const local = clock(iso, zone);
  try {
    const a = localToInstant(local, zone, 'earlier'),
      b = localToInstant(local, zone, 'later');
    return a === b ? undefined : Date.parse(iso) >= b ? 'later' : 'earlier';
  } catch {
    return undefined;
  }
}
export function AdherenceForm({
  action,
  tripId,
  existing,
  onSave,
  onClose,
}: {
  action: PlanAction;
  tripId: string;
  existing?: AdherenceRecord;
  onSave: (record: AdherenceRecord) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<AdherenceRecord['status']>(existing?.status ?? 'completed');
  const [start, setStart] = useState(clock(existing?.actualStart ?? action.start, action.timeZone));
  const [end, setEnd] = useState(clock(existing?.actualEnd ?? action.end, action.timeZone));
  const [startChoice, setStartChoice] = useState(
    occurrence(existing?.actualStart ?? action.start, action.timeZone),
  );
  const [endChoice, setEndChoice] = useState(
    occurrence(existing?.actualEnd ?? action.end, action.timeZone),
  );
  const [error, setError] = useState('');
  function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      const actual =
        status === 'missed'
          ? {}
          : {
              actualStart: new Date(
                localToInstant(start, action.timeZone, startChoice),
              ).toISOString(),
              actualEnd: new Date(localToInstant(end, action.timeZone, endChoice)).toISOString(),
            };
      if (
        'actualStart' in actual &&
        (Date.parse(actual.actualEnd!) <= Date.parse(actual.actualStart!) ||
          Date.parse(actual.actualEnd!) > Date.now() + 60000)
      )
        throw new Error('Record an interval that has ended, with the end after the start.');
      if (Date.parse(action.start) > Date.now())
        throw new Error('Record an action after its scheduled start.');
      onSave({
        id: existing?.id ?? crypto.randomUUID(),
        tripId,
        actionId: action.id,
        type: action.type,
        scheduledStart: action.start,
        scheduledEnd: action.end,
        timeZone: action.timeZone,
        status,
        ...actual,
        recordedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the recorded times.');
    }
  }
  return (
    <form onSubmit={save}>
      <p className="modal-intro">
        {action.title} · {action.timeZone}. Light and sleep records refine future estimates;
        caffeine and melatonin records are a diary.
      </p>
      <label className="field">
        <span>What happened?</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as AdherenceRecord['status'])}
        >
          <option value="completed">Completed</option>
          <option value="partial">Partly completed</option>
          <option value="missed">Missed</option>
        </select>
      </label>
      {status !== 'missed' && (
        <>
          <div className="field-grid">
            <label className="field">
              <span>Actual start (local)</span>
              <input
                type="datetime-local"
                value={start}
                onChange={(event) => {
                  setStart(event.target.value);
                  setStartChoice(undefined);
                }}
                required
              />
            </label>
            <label className="field">
              <span>Actual end (local)</span>
              <input
                type="datetime-local"
                value={end}
                onChange={(event) => {
                  setEnd(event.target.value);
                  setEndChoice(undefined);
                }}
                required
              />
            </label>
          </div>
          <FoldChoice
            local={start}
            zone={action.timeZone}
            value={startChoice}
            onChange={setStartChoice}
            label="Actual start"
          />
          <FoldChoice
            local={end}
            zone={action.timeZone}
            value={endChoice}
            onChange={setEndChoice}
            label="Actual end"
          />
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          Save record
        </button>
      </div>
    </form>
  );
}
