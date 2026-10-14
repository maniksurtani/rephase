import { describe, expect, it } from 'vitest';
import { buildCalendar } from '../src/lib/export';
import type { Plan, Trip } from '../src/lib/types';

const trip: Trip = {id:'trip-1',name:'Tokyo, then home',legs:[],createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z'};
const plan: Plan = {version:'rules-v1',tripId:trip.id,generatedAt:trip.createdAt,warnings:[],summary:{destinations:1,flightHours:12,timeZoneChanges:1},days:[{
  id:'day-1',date:'2026-10-15',timeZone:'Asia/Tokyo',label:'Tokyo',stage:'destination',phaseShiftHours:0,remainingShiftHours:8,note:'',actions:[{
    id:'sleep-1',type:'sleep',start:'2026-10-15T14:00:00Z',end:'2026-10-15T22:00:00Z',timeZone:'Asia/Tokyo',title:'Sleep',detail:'A quiet night; rest, then wake.\nBEGIN:VEVENT',reason:'旅'.repeat(90)
  }]
}]};
describe('calendar export', () => {
  it('exports absolute UTC times across destination midnight and escapes content injection', () => {
    const text = buildCalendar(plan,trip);
    expect(text).toContain('DTSTART:20261015T140000Z\r\n');
    expect(text).toContain('DTEND:20261015T220000Z\r\n');
    expect(text).toContain('night\\; rest\\, then wake.\\nBEGIN:VEVENT');
    expect(text.match(/^BEGIN:VEVENT$/gm)?.length).toBe(1);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
  it('folds UTF-8 content into valid physical lines without splitting characters', () => {
    const lines = buildCalendar(plan,trip).split('\r\n');
    expect(lines.every(line => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(lines.join('\r\n').replace(/\r\n /g,'')).toContain('旅'.repeat(90));
  });
  it('can omit alarms and does not duplicate the same interval across day displays', () => {
    const repeated = {...plan,days:[...plan.days,plan.days[0]]};
    const text = buildCalendar(repeated,trip,false);
    expect(text).not.toContain('BEGIN:VALARM');
    expect(text.match(/^BEGIN:VEVENT$/gm)?.length).toBe(1);
  });
  it('merges a midnight sleep continuation so it cannot alarm after bedtime',()=> {
    const action=plan.days[0].actions[0];
    const split={...plan,days:[{...plan.days[0],actions:[{...action,start:'2026-10-15T23:00:00Z',end:'2026-10-16T00:00:00Z'}]},
      {...plan.days[0],id:'next-day',date:'2026-10-16',actions:[{...action,id:'continued-sleep',start:'2026-10-16T00:00:00Z',end:'2026-10-16T07:00:00Z'}]}]};
    const text=buildCalendar(split,trip);
    expect(text.match(/^BEGIN:VEVENT$/gm)?.length).toBe(1);
    expect(text.match(/^BEGIN:VALARM$/gm)?.length).toBe(1);
    expect(text).toContain('DTEND:20261016T070000Z');
    expect(text).not.toContain('DTSTART:20261016T000000Z');
  });
});
