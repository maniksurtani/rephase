export type Chronotype = 'early' | 'intermediate' | 'late' | 'unsure';
export type AdaptationStrategy = 'adapt' | 'partial' | 'home';
export type TravelClass = 'economy' | 'premium-economy' | 'business' | 'first';
export interface Preferences {
  homeTimeZone: string;
  chronotype: Chronotype;
  usualBedtime: string;
  usualWakeTime: string;
  preferredBedtime: string;
  preferredWakeTime: string;
  sleepHours: number;
  sleepAnchor: 'wake' | 'bed';
  caffeine: boolean;
  melatonin: boolean;
  melatoninAcknowledged: boolean;
  preparationDays: number;
}
export interface FlightLeg {
  id: string;
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureDateTime: string;
  arrivalDateTime: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
  stayAfter: 'connection' | 'destination';
  strategy: AdaptationStrategy;
  /** Optional only for compatibility with existing schema-1 saved trips. */
  travelClass?: TravelClass;
  lieFlat?: boolean;
}
export interface Trip {
  id: string;
  name: string;
  legs: FlightLeg[];
  createdAt: string;
  updatedAt: string;
}
export type ActionType = 'sleep' | 'light' | 'avoid-light' | 'caffeine' | 'melatonin';
export interface PlanAction {
  id: string;
  type: ActionType;
  start: string;
  end: string;
  timeZone: string;
  title: string;
  detail: string;
  reason: string;
  dose?: string;
  evidenceUrl?: string;
}
export interface PlanDay {
  id: string;
  date: string;
  timeZone: string;
  label: string;
  stage: 'preparation' | 'travel' | 'destination' | 'home';
  actions: PlanAction[];
  phaseShiftHours: number;
  remainingShiftHours: number;
  note: string;
}
export interface Plan {
  version: string;
  tripId: string;
  generatedAt: string;
  days: PlanDay[];
  warnings: string[];
  summary: { destinations: number; flightHours: number; timeZoneChanges: number };
}
export interface AppData {
  schemaVersion: 1;
  preferences: Preferences;
  trips: Trip[];
  selectedTripId: string | null;
}
export interface Account {
  id: string;
  name: string;
  email: string;
}
