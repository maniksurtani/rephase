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
  planningMode?: 'rules' | 'model';
  autoSync?: boolean;
  calendarAlarms?: boolean;
}
/** Planned equipment only; it does not establish an airline's seat layout. */
export interface AircraftType {
  model: string;
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
  departureDisambiguation?: 'earlier' | 'later';
  arrivalDisambiguation?: 'earlier' | 'later';
  takeoffDateTime?: string;
  landingDateTime?: string;
  taxiOutMinutes?: number;
  taxiInMinutes?: number;
  flightSource?: 'manual' | 'aerodatabox';
  flightFetchedAt?: string;
  providerRecordConfirmed?: boolean;
  aircraft?: AircraftType;
}
export interface AdherenceRecord {
  id: string;
  tripId: string;
  actionId: string;
  type: ActionType;
  scheduledStart: string;
  scheduledEnd: string;
  timeZone: string;
  status: 'completed' | 'missed' | 'partial';
  actualStart?: string;
  actualEnd?: string;
  recordedAt: string;
}
export interface Trip {
  id: string;
  name: string;
  legs: FlightLeg[];
  createdAt: string;
  updatedAt: string;
  adherence?: AdherenceRecord[];
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
  feasibility?: 'daylight' | 'indoor' | 'unknown';
}
export interface MealWindow {
  id: string;
  start: string;
  end: string;
  location: 'before-flight' | 'in-flight' | 'after-flight';
  title: string;
  detail: string;
}
export interface FlightMealPlan {
  wakeForMeals: boolean;
  advice: string;
  reason: string;
  sleepStart?: string;
  sleepEnd?: string;
  windows: MealWindow[];
}
/** Gate-to-gate itinerary facts, independent of optional sleep/light recommendations. */
export interface PlanTravelSegment {
  id: string;
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departure: string;
  arrival: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
  mealPlan?: FlightMealPlan;
  aircraft?: AircraftType;
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
  travelSegments?: PlanTravelSegment[];
  /** False for schedule-only days or missing/ambiguous model history. */
  phaseEstimateAvailable?: boolean;
}
export interface Plan {
  version: string;
  tripId: string;
  generatedAt: string;
  days: PlanDay[];
  warnings: string[];
  summary: { destinations: number; flightHours: number; timeZoneChanges: number };
  model?: {
    name: string;
    numericallyVerified: boolean;
    clinicallyValidated: false;
    strategy: 'advance' | 'delay' | 'mixed';
    assumptions: string[];
  };
}
export interface FlightCandidate {
  id: string;
  flightNumber: string;
  airline: string;
  aircraft?: AircraftType;
  operatingFlightNumber?: string;
  departureAirport: string;
  arrivalAirport: string;
  departureDateTime: string;
  arrivalDateTime: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
  departureUtc: string;
  arrivalUtc: string;
  durationMinutes: number;
  takeoffDateTime?: string;
  landingDateTime?: string;
  departureDisambiguation?: 'earlier' | 'later';
  arrivalDisambiguation?: 'earlier' | 'later';
}
export interface FlightLookupResult {
  provider: 'aerodatabox';
  candidates: FlightCandidate[];
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
  attribution: string;
  warnings: string[];
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
  picture?: string;
}
