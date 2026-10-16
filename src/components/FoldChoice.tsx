import { localToInstant } from '../lib/time';
export function FoldChoice({
  local,
  zone,
  value,
  onChange,
  label,
}: {
  local: string;
  zone: string;
  value?: 'earlier' | 'later';
  onChange: (value: 'earlier' | 'later' | undefined) => void;
  label: string;
}) {
  if (!local || !zone) return null;
  try {
    const earlier = localToInstant(local, zone, 'earlier'),
      later = localToInstant(local, zone, 'later');
    if (earlier === later) return null;
    return (
      <label className="field fold-choice">
        <span>{label}: this clock time occurs twice</span>
        <select
          value={value ?? ''}
          onChange={(event) =>
            onChange((event.target.value || undefined) as 'earlier' | 'later' | undefined)
          }
          required
        >
          <option value="">Choose the UTC offset on your booking</option>
          <option value="earlier">
            Earlier occurrence · {new Date(earlier).toISOString().slice(11, 16)} UTC
          </option>
          <option value="later">
            Later occurrence · {new Date(later).toISOString().slice(11, 16)} UTC
          </option>
        </select>
      </label>
    );
  } catch {
    return null;
  }
}
