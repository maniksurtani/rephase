import { AccountStateApi, emptyAppData as emptyData } from './support/fixtures';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { FlightCandidate, FlightLookupResult, Trip } from '../src/lib/types';

const account = {
  id: 'aircraft-account',
  name: 'Aircraft traveler',
  email: 'aircraft@example.com',
};
const model = 'Boeing 777-300ER (extended range)';
const candidate: FlightCandidate = {
  id: 'ba286-aircraft',
  flightNumber: 'BA286',
  airline: 'British Airways',
  departureAirport: 'SFO',
  arrivalAirport: 'LHR',
  departureDateTime: '2026-12-01T20:00',
  arrivalDateTime: '2026-12-02T14:00',
  departureTimeZone: 'America/Los_Angeles',
  arrivalTimeZone: 'Europe/London',
  departureUtc: '2026-12-02T04:00:00Z',
  arrivalUtc: '2026-12-02T14:00:00Z',
  durationMinutes: 600,
  aircraft: { model },
};
const fetchedAt = '2026-10-14T12:00:00Z';

function savedTrip(): Trip {
  return {
    id: 'aircraft-journey',
    name: 'Aircraft journey',
    createdAt: fetchedAt,
    updatedAt: fetchedAt,
    legs: [
      {
        id: 'aircraft-leg',
        flightNumber: candidate.flightNumber,
        departureAirport: candidate.departureAirport,
        arrivalAirport: candidate.arrivalAirport,
        departureDateTime: candidate.departureDateTime,
        arrivalDateTime: candidate.arrivalDateTime,
        departureTimeZone: candidate.departureTimeZone,
        arrivalTimeZone: candidate.arrivalTimeZone,
        aircraft: { model },
        stayAfter: 'destination',
        strategy: 'adapt',
        travelClass: 'economy',
        lieFlat: false,
        flightSource: 'aerodatabox',
        flightFetchedAt: fetchedAt,
        providerRecordConfirmed: true,
      },
    ],
  };
}

class AircraftApi extends AccountStateApi {
  candidate: FlightCandidate = candidate;
  constructor() {
    super(account, { flightLookupAvailable: true });
  }
  async install(page: Page) {
    await super.install(page);
    await page.route('**/api/flights?*', (route) => {
      expect(route.request().headers()['x-rephase-account']).toBe(account.id);
      const result: FlightLookupResult = {
        provider: 'aerodatabox',
        candidates: [this.candidate],
        fetchedAt,
        expiresAt: '2026-10-16T12:00:00Z',
        stale: false,
        attribution: 'Flight data by AeroDataBox',
        warnings: [],
      };
      return route.fulfill({ json: result });
    });
  }
}

async function openTrips(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: `${account.name}'s account menu` })).toBeVisible();
  await page.getByRole('button', { name: 'Trips', exact: true }).first().click();
}

async function createTrip(page: Page) {
  await openTrips(page);
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Plan a new journey', exact: true });
  await editor.getByLabel('Trip name').fill('Aircraft journey');
  await editor.getByLabel('Flight number', { exact: true }).fill(candidate.flightNumber);
  await editor.getByLabel('Departure date at the departure airport').fill('2026-12-01');
  return editor;
}

async function findFlight(editor: Locator) {
  await editor.getByRole('button', { name: 'Look up flight', exact: true }).click();
  const result = editor.locator('.flight-result');
  await expect(result).toBeVisible();
  return result;
}

async function useFlight(editor: Locator) {
  await expect(editor.getByRole('checkbox')).toHaveCount(0);
  const use = editor.getByRole('button', { name: 'Use this flight', exact: true });
  await expect(use).toBeEnabled();
  await use.click();
}

test('a replacement lookup with no aircraft clears the previous model and remains saveable', async ({
  page,
}) => {
  const api = new AircraftApi();
  await api.install(page);
  const editor = await createTrip(page);
  await findFlight(editor);
  await useFlight(editor);
  await expect(editor.locator('.flight-selection-aircraft')).toHaveText(`Aircraft · ${model}`);
  const { aircraft: _omitted, ...withoutAircraft } = candidate;
  api.candidate = withoutAircraft;
  const unknown = await findFlight(editor);
  await expect(unknown.locator('.flight-aircraft')).toHaveText('Aircraft type not provided');
  await useFlight(editor);
  await expect(editor.locator('.flight-selection-aircraft')).toHaveText(
    'Aircraft type not provided',
  );
  await expect(editor.getByText(model, { exact: false })).toHaveCount(0);
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await expect(editor.getByLabel('Lie-flat bed available?')).toHaveValue('no');
  await editor.getByRole('button', { name: 'Create my plan', exact: true }).click();
  await expect.poll(() => api.data.trips.length).toBe(1);
  expect(api.data.trips[0].legs[0]).not.toHaveProperty('aircraft');
  await page.getByRole('button', { name: 'Trips', exact: true }).first().click();
  await expect(page.locator('.mini-aircraft')).toHaveCount(0);
});

test('manual identity changes discard stale aircraft while timing and cabin edits preserve it', async ({
  page,
}) => {
  const api = new AircraftApi();
  const trip = savedTrip();
  api.data = { ...emptyData(), trips: [trip], selectedTripId: trip.id };
  await api.install(page);
  async function editSavedTrip() {
    await openTrips(page);
    await page.getByRole('button', { name: 'Edit Aircraft journey', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit your journey', exact: true });
    await editor.getByRole('button', { name: 'Enter manually', exact: true }).click();
    return editor;
  }
  const editor = await editSavedTrip();
  await editor.getByLabel('Local departure date & time').fill('2026-12-01T20:15');
  await editor.getByLabel('Local arrival date & time').fill('2026-12-02T14:15');
  await editor.getByLabel('Departure time zone').fill('UTC');
  await editor.getByLabel('Travel class').selectOption('business');
  await editor.getByLabel('Flight number', { exact: true }).fill('ba 286');
  await editor.getByLabel('Airport code').first().fill('sfo');
  await editor.locator('.flight-operations > summary').click();
  await editor
    .getByLabel('Known takeoff time (departure local, optional)')
    .fill('2026-12-01T20:45');
  await editor.getByLabel('Known landing time (arrival local, optional)').fill('2026-12-02T13:45');
  await expect(editor.locator('.flight-selection-aircraft')).toHaveText(`Aircraft · ${model}`);
  await expect(editor.getByLabel('Lie-flat bed available?')).toHaveValue('no');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();

  for (const identity of ['number', 'departure date', 'departure airport', 'arrival airport']) {
    await test.step(`changing ${identity} clears the previous aircraft`, async () => {
      const draft = await editSavedTrip();
      await expect(draft.locator('.flight-selection-aircraft')).toHaveText(`Aircraft · ${model}`);
      if (identity === 'number')
        await draft.getByLabel('Flight number', { exact: true }).fill('BA117');
      else if (identity === 'departure date')
        await draft.getByLabel('Departure date at the departure airport').fill('2026-12-03');
      else
        await draft
          .getByLabel('Airport code')
          .nth(identity === 'departure airport' ? 0 : 1)
          .fill(identity === 'departure airport' ? 'JFK' : 'CDG');
      await expect(draft.locator('.flight-selection-aircraft')).toHaveText(
        'Aircraft type not provided',
      );
      await draft.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
  }
  expect(api.writes).toEqual([]);
});
