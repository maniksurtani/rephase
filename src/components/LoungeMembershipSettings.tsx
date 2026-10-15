import { Armchair } from 'lucide-react';
import { LOUNGE_MEMBERSHIPS, type LoungeMembership } from '../lib/lounge-types';
import './lounge-memberships.css';

interface Props {
  memberships: LoungeMembership[];
  onChange: (memberships: LoungeMembership[]) => void;
}

export function LoungeMembershipSettings({ memberships, onChange }: Props) {
  function toggleMembership(id: LoungeMembership, checked: boolean) {
    onChange(checked ? [...memberships.filter(value => value !== id), id] : memberships.filter(value => value !== id));
  }

  return <section className="form-section lounge-membership-settings" aria-labelledby="lounge-membership-settings-title">
    <div className="form-section-title"><span className="small-icon"><Armchair size={19}/></span><div><h2 id="lounge-membership-settings-title" tabIndex={-1}>Lounge memberships & airline status</h2><p>Use your saved programs when exploring airport lounges.</p></div></div>
    <fieldset className="lounge-programs"><legend className="sr-only">Your lounge memberships and airline status</legend>{LOUNGE_MEMBERSHIPS.map(program => <label key={program.id}><input type="checkbox" checked={memberships.includes(program.id)} onChange={event => toggleMembership(program.id, event.target.checked)}/><span>{program.label}</span></label>)}</fieldset>
    <p className="lounge-settings-note">Choose your airline’s status where listed. Use Save preferences to remember your memberships.</p>
  </section>;
}
