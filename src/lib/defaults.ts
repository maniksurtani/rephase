import { Temporal } from '@js-temporal/polyfill';
import type { AppData, FlightLeg, Preferences, Trip } from './types';

export const DEFAULT_PREFERENCES: Preferences = {
  homeTimeZone: 'America/Los_Angeles',
  chronotype: 'intermediate',
  usualBedtime: '23:00',
  usualWakeTime: '07:00',
  preferredBedtime: '23:00',
  preferredWakeTime: '07:00',
  sleepHours: 8,
  sleepAnchor: 'wake',
  caffeine: true,
  melatonin: false,
  melatoninAcknowledged: false,
  preparationDays: 3,
  planningMode: 'model',
  autoSync: false,
  calendarAlarms: true,
};
export function createLeg(): FlightLeg {
  return {
    id: crypto.randomUUID(),
    flightNumber: '',
    departureAirport: '',
    arrivalAirport: '',
    departureDateTime: '',
    arrivalDateTime: '',
    departureTimeZone: 'America/Los_Angeles',
    arrivalTimeZone: 'Europe/London',
    stayAfter: 'destination',
    strategy: 'adapt',
    travelClass: 'economy',
    lieFlat: false,
  };
}
export function createEmptyTrip(): Trip {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: 'My next journey',
    legs: [createLeg()],
    createdAt: now,
    updatedAt: now,
  };
}
export function createDemoTrip(): Trip {
  const today = Temporal.Now.plainDateISO('America/Los_Angeles');
  const at = (day: number, time: string) => `${today.add({ days: day })}T${time}`;
  const legs: FlightLeg[] = [
    {
      ...createLeg(),
      departureAirport: 'SFO',
      arrivalAirport: 'LHR',
      departureDateTime: at(4, '18:30'),
      arrivalDateTime: at(5, '13:00'),
      departureTimeZone: 'America/Los_Angeles',
      arrivalTimeZone: 'Europe/London',
    },
    {
      ...createLeg(),
      departureAirport: 'LHR',
      arrivalAirport: 'DXB',
      departureDateTime: at(9, '14:30'),
      arrivalDateTime: at(10, '01:30'),
      departureTimeZone: 'Europe/London',
      arrivalTimeZone: 'Asia/Dubai',
      stayAfter: 'connection',
    },
    {
      ...createLeg(),
      departureAirport: 'DXB',
      arrivalAirport: 'SIN',
      departureDateTime: at(10, '04:00'),
      arrivalDateTime: at(10, '15:30'),
      departureTimeZone: 'Asia/Dubai',
      arrivalTimeZone: 'Asia/Singapore',
    },
    {
      ...createLeg(),
      departureAirport: 'SIN',
      arrivalAirport: 'SFO',
      departureDateTime: at(14, '09:25'),
      arrivalDateTime: at(14, '09:00'),
      departureTimeZone: 'Asia/Singapore',
      arrivalTimeZone: 'America/Los_Angeles',
    },
  ];
  // Example cabin settings only; actual bed availability must be confirmed by the traveler.
  for (const leg of legs) {
    leg.travelClass = 'business';
    leg.lieFlat = true;
  }
  const now = new Date().toISOString();
  return {
    id: `demo-${crypto.randomUUID()}`,
    name: 'London & Singapore',
    legs,
    createdAt: now,
    updatedAt: now,
  };
}
export function createInitialData(): AppData {
  const trip = createDemoTrip();
  return {
    schemaVersion: 1,
    preferences: { ...DEFAULT_PREFERENCES },
    trips: [trip],
    selectedTripId: trip.id,
  };
}
