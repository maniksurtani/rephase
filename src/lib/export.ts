import type { AppData, Plan, PlanAction, Trip } from './types';
import { effectiveSleepIntervals } from './plan-meals';

export const escapeIcs = (s: string) => s.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const utcStamp = (s: string) => new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function foldLine(line: string): string {
  let result = '', current = '', bytes = 0;
  for (const character of line) {
    const length = new TextEncoder().encode(character).length;
    if (bytes + length > 75) { result += `${current}\r\n`; current = ' '; bytes = 1; }
    current += character; bytes += length;
  }
  return result + current;
}
export function buildCalendar(plan: Plan, trip: Trip, withAlarms = true): string {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Rephase//Travel Plan//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${escapeIcs(`Rephase · ${trip.name}`)}`];
  const seen = new Set<string>();
  const merged:PlanAction[]=[];
  const ordered=plan.days.flatMap(day=>day.actions).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  for(const action of ordered) {
    const signature = `${action.type}:${action.start}:${action.end}`;
    if (seen.has(signature) || !Number.isFinite(Date.parse(action.start)) || Date.parse(action.end) <= Date.parse(action.start)) continue;
    seen.add(signature);
    const previous=merged.at(-1);
    if(previous && previous.type===action.type && previous.end===action.start && previous.timeZone===action.timeZone
      && previous.title===action.title && previous.detail===action.detail && previous.reason===action.reason && previous.dose===action.dose) {
      previous.end=action.end;
    } else merged.push({...action});
  }
  for(const action of merged) {
    lines.push('BEGIN:VEVENT',`UID:${action.id.replace(/[^a-zA-Z0-9._-]/g,'-')}-${trip.id.replace(/[^a-zA-Z0-9._-]/g,'-')}@rephase.local`,
      `DTSTAMP:${utcStamp(plan.generatedAt)}`,`DTSTART:${utcStamp(action.start)}`,`DTEND:${utcStamp(action.end)}`,
      `SUMMARY:${escapeIcs(action.title)}`,
      `DESCRIPTION:${escapeIcs([action.detail,action.reason,action.dose ? `General dose information: ${action.dose}` : '',`Display zone: ${action.timeZone}`,`Engine: ${plan.version}. Estimated guidance.`].filter(Boolean).join('\n'))}`,
      'TRANSP:TRANSPARENT');
    if (withAlarms) lines.push('BEGIN:VALARM','TRIGGER:-PT10M','ACTION:DISPLAY',`DESCRIPTION:${escapeIcs(action.title)}`,'END:VALARM');
    lines.push('END:VEVENT');
  }
  // Flight segments can appear on several calendar days. Meals are practical
  // suggestions, and must never introduce reminders that interrupt planned sleep.
  const mealIds = new Set<string>();
  const mealIntervals = new Set<string>();
  const sleep = effectiveSleepIntervals(plan, trip);
  for (const segment of plan.days.flatMap(day => day.travelSegments ?? [])) {
    const mealPlan = segment.mealPlan;
    if (!mealPlan) continue;
    for (const meal of mealPlan.windows) {
      // An explicit offset is necessary: a floating local clock must not acquire
      // the timezone of the computer performing the export.
      if (![meal.start, meal.end].every(value => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value))) continue;
      const start = Date.parse(meal.start), end = Date.parse(meal.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const interval = `${start}:${end}`;
      if (mealIds.has(meal.id) || mealIntervals.has(interval)
        || sleep.some(rest => start < rest.end && end > rest.start)) continue;
      mealIds.add(meal.id); mealIntervals.add(interval);
      const location = meal.location === 'before-flight' ? 'Before departure'
        : meal.location === 'after-flight' ? 'After arrival' : 'During the flight';
      lines.push('BEGIN:VEVENT',
        `UID:meal-${utcStamp(meal.start)}-${utcStamp(meal.end)}-${trip.id.replace(/[^a-zA-Z0-9._-]/g,'-')}@rephase.local`,
        `DTSTAMP:${utcStamp(plan.generatedAt)}`,`DTSTART:${utcStamp(meal.start)}`,`DTEND:${utcStamp(meal.end)}`,
        `SUMMARY:${escapeIcs(`Suggested meal · ${meal.title}`)}`,
        `DESCRIPTION:${escapeIcs([
          `${segment.flightNumber} · ${segment.departureAirport} → ${segment.arrivalAirport}`,
          location, meal.detail, mealPlan.advice, mealPlan.reason,
          'Practical suggestion; airline meal service times are not known. No reminder is set, to avoid interrupting sleep.',
          `Origin zone: ${segment.departureTimeZone}. Destination zone: ${segment.arrivalTimeZone}. Calendar times are absolute UTC instants.`,
          `Engine: ${plan.version}. Estimated guidance.`,
        ].filter(Boolean).join('\n'))}`,
        'TRANSP:TRANSPARENT','END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
function download(contents: string, mime: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents],{type:mime}));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
export function exportCalendar(plan: Plan, trip: Trip, withAlarms = true) {
  download(buildCalendar(plan,trip,withAlarms),'text/calendar;charset=utf-8','rephase-plan.ics');
}
export function exportData(data: AppData) {
  download(JSON.stringify(data,null,2),'application/json',`rephase-backup-${new Date().toISOString().slice(0,10)}.json`);
}
