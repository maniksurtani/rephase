import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import type { AppData, Trip } from '../src/lib/types';
import { validateAppData } from '../src/lib/validation';
import octoberItinerary from '../tests/fixtures/itineraries/oct2026.json' with { type: 'json' };

test.use({ actionTimeout: 30_000 });

const account = { id: 'lounge-traveler', name: 'Lounge traveler', email: 'lounges@example.com' };
const emptyData = (): AppData => ({
  schemaVersion: 1, preferences: { ...DEFAULT_PREFERENCES, planningMode: 'rules' }, trips: [], selectedTripId: null,
});

/** Apply the same persisted-data validator as the Worker to every saved draft. */
class LoungeAccountApi {
  data = emptyData();
  revision = 1;
  writes: AppData[] = [];
  async install(page: Page) {
    await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
      contentType: 'application/javascript',
      body: 'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}};',
    }));
    await page.route('**/api/auth/challenge', route => route.fulfill({ json: { nonce: 'lounge-test-nonce' } }));
    await page.route('**/api/config', route => route.fulfill({
      json: { googleClientId: 'test-client', syncAvailable: true, flightLookupAvailable: false },
    }));
    await page.route('**/api/me', route => route.fulfill({ json: account }));
    await page.route('**/api/state', route => {
      expect(route.request().headers()['x-rephase-account']).toBe(account.id);
      if (route.request().method() === 'GET') return route.fulfill({ json: { data: this.data, revision: this.revision } });
      const body = route.request().postDataJSON() as { data: AppData; revision: number };
      expect(validateAppData(body.data)).toBeNull();
      if (body.revision !== this.revision) return route.fulfill({ status: 409, json: { error: 'Changed on another device' } });
      this.data = structuredClone(body.data);
      this.writes.push(this.data);
      this.revision++;
      return route.fulfill({ json: { revision: this.revision } });
    });
  }
}

async function openLounges(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: `${account.name}'s account menu` })).toBeVisible();
  await page.getByRole('button', { name: 'Lounges', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Lounge Explorer', exact: true })).toBeVisible();
}

function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth);
}

test('lounge memberships and recommendation priority save automatically to the validated account and survive reopening', async ({ page }) => {
  const api = new LoungeAccountApi();
  await api.install(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
  await openLounges(page);
  const priorityPass = page.getByRole('checkbox', { name: 'Priority Pass', exact: true });
  const qantasPlatinum = page.getByRole('checkbox', { name: 'Qantas Platinum', exact: true });
  await priorityPass.check();
  await qantasPlatinum.check();
  await page.getByRole('combobox', { name: 'Prioritise', exact: true }).selectOption('showers');
  await expect.poll(() => api.data.preferences.loungeMemberships).toEqual(['priority-pass', 'qantas-platinum']);
  await expect.poll(() => api.data.preferences.loungePriority).toBe('showers');
  expect(api.writes.length).toBeGreaterThan(0);
  expect(validateAppData(api.data)).toBeNull();
  await page.reload();
  await page.getByRole('button', { name: 'Lounges', exact: true }).first().click();
  await page.locator('.lounge-memberships-panel summary').click();
  await expect(priorityPass).toBeChecked();
  await expect(qantasPlatinum).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Prioritise', exact: true })).toHaveValue('showers');
  await expect(page.locator('.lounge-card').first()).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('confirmed airline and terminal unlock a sourced lounge recommendation, and a closed visit removes it', async ({ page }) => {
  const api = new LoungeAccountApi();
  api.data.preferences.loungeMemberships = ['qantas-platinum'];
  api.data.preferences.loungePriority = 'showers';
  await api.install(page);
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
  await openLounges(page);
  await page.getByRole('combobox', { name: 'Airport', exact: true }).fill('SYD');
  await page.getByLabel('Visit date', { exact: true }).fill('2026-10-17');
  await page.getByLabel('From', { exact: true }).fill('10:00');
  await page.getByLabel('Until', { exact: true }).fill('12:00');
  await page.getByLabel('Departure time', { exact: true }).fill('13:00');
  await page.getByRole('combobox', { name: 'Marketing airline', exact: true }).selectOption('QF');
  await page.getByRole('combobox', { name: 'Departure terminal', exact: true }).selectOption('T1');
  const firstLounge = page.locator('.lounge-card[data-lounge-id="syd-qantas-first"]');
  await expect(firstLounge).toBeVisible();
  await expect(firstLounge.locator('.lounge-access')).toHaveText('Check access');
  await expect(firstLounge.locator('.lounge-recommended')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Operating airline', exact: true }).selectOption('QF');
  await expect(firstLounge.locator('.lounge-access')).toHaveText('Access matches');
  await expect(firstLounge.locator('.lounge-opening')).toHaveText('Open during your visit');
  await expect(firstLounge.locator('.lounge-recommended')).toHaveText('Recommended');
  await expect(firstLounge.locator('.lounge-amenities')).toContainText('Showers');
  await expect(firstLounge.locator('.lounge-amenities')).toContainText('Restaurant');
  await firstLounge.locator('summary').filter({ hasText: 'Access & sources' }).click();
  await expect(firstLounge.getByRole('link', { name: 'Qantas lounge access and eligibility' })).toHaveAttribute('href', 'https://www.qantas.com/en-au/at-the-airport/lounges/access');
  await expect(firstLounge.getByText('Sources checked 2026-10-15.', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await firstLounge.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/lounge-explorer-desktop.png' });

  await page.getByLabel('From', { exact: true }).fill('04:00');
  await page.getByLabel('Until', { exact: true }).fill('04:45');
  await page.getByLabel('Departure time', { exact: true }).fill('06:00');
  await expect(firstLounge.locator('.lounge-opening')).toHaveText('Closed during your visit');
  await expect(firstLounge.locator('.lounge-recommended')).toHaveCount(0);
});

test('mobile travel links prefill the correct airport, local visit clocks and cabin, while a short transit has no lounge offer', async ({ page }) => {
  const api = new LoungeAccountApi();
  const itinerary = structuredClone(octoberItinerary.trip) as Trip;
  itinerary.legs.find(leg => leg.id === 'qf94')!.travelClass = 'business';
  api.data = { ...emptyData(), trips: [itinerary], selectedTripId: itinerary.id };
  await api.install(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-10-24T15:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: itinerary.name, exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await navigation.getByRole('button', { name: 'Your plan', exact: true }).click();
  // QF94 remains in transit on the 25th and arrives on the 26th. Its
  // pre-departure lounge window belongs only to the LAX departure day.
  for (const date of ['2026-10-25', '2026-10-26']) {
    await page.locator(`.day-button[data-date="${date}"]`).click();
    await expect(page.locator('.flight-segment-card[data-flight-id="qf94"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Explore lounges in LAX', exact: true })).toHaveCount(0);
  }
  await page.locator('.day-button[data-date="2026-10-24"]').click();
  const connection = page.locator('.flight-segment-card[data-flight-id="qf94"]');
  await expect(connection).toBeVisible();
  await page.getByRole('button', { name: 'Explore lounges in LAX', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lounge Explorer', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Airport', exact: true })).toHaveValue('LAX');
  await expect(page.getByLabel('Visit date', { exact: true })).toHaveValue('2026-10-24');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('18:14');
  await expect(page.getByLabel('Until', { exact: true })).toHaveValue('22:55');
  await expect(page.getByLabel('Departure time', { exact: true })).toHaveValue('23:40');
  await expect(page.getByRole('combobox', { name: 'Cabin', exact: true })).toHaveValue('business');
  // A flight number identifies the marketing airline only. A codeshare must
  // never become an assumed operating carrier when entering access checks.
  await expect(page.getByRole('combobox', { name: 'Operating airline', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Marketing airline', exact: true })).toHaveValue('QF');
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.screenshot({ path: 'artifacts/lounge-explorer-mobile.png' });
  await page.getByRole('combobox', { name: 'Operating airline', exact: true }).selectOption('QF');
  await page.getByRole('combobox', { name: 'Departure terminal', exact: true }).selectOption('Tom Bradley International Terminal');
  await page.getByRole('combobox', { name: 'Airport', exact: true }).fill('SYD');
  await expect(page.locator('.lounge-context')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Operating airline', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Marketing airline', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Departure terminal', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Cabin', exact: true })).toHaveValue('economy');

  // The preceding domestic arrival at 17:44 leaves no useful lounge visit
  // once the arrival and boarding buffers are applied to a 19:05 departure.
  const shorterTrip = structuredClone(itinerary);
  shorterTrip.legs.find(leg => leg.id === 'qf94')!.departureDateTime = '2026-10-24T19:05';
  api.data = { ...api.data, trips: [shorterTrip] };
  api.revision++;
  await page.reload();
  await expect(page.getByRole('heading', { name: itinerary.name, exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Your plan', exact: true }).click();
  await page.locator('.day-button[data-date="2026-10-24"]').click();
  await expect(page.locator('.flight-segment-card[data-flight-id="qf94"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore lounges in LAX', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Explore lounges in SFO', exact: true })).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('a lounge visit across the autumn clock change preserves the later departure and visit-end occurrences', async ({ page }) => {
  const api = new LoungeAccountApi();
  const trip: Trip = {
    id: 'lounge-fall-back', name: 'Autumn clock-change journey',
    createdAt: '2026-10-15T12:00:00Z', updatedAt: '2026-10-15T12:00:00Z',
    legs: [{
      id: 'lounge-fall-back-flight', flightNumber: 'AS123', departureAirport: 'SFO', arrivalAirport: 'LAX',
      departureDateTime: '2026-11-01T01:30', arrivalDateTime: '2026-11-01T03:00',
      departureTimeZone: 'America/Los_Angeles', arrivalTimeZone: 'America/Los_Angeles',
      departureDisambiguation: 'later', stayAfter: 'destination', strategy: 'adapt', travelClass: 'economy',
    }],
  };
  api.data = { ...emptyData(), trips: [trip], selectedTripId: trip.id };
  await api.install(page);
  await page.clock.setFixedTime(new Date('2026-10-31T21:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: trip.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your plan', exact: true }).first().click();
  await page.locator('.day-button[data-date="2026-11-01"]').click();
  await page.getByRole('button', { name: 'Explore lounges in SFO', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lounge Explorer', exact: true })).toBeVisible();
  await expect(page.getByLabel('Visit date', { exact: true })).toHaveValue('2026-11-01');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('00:30');
  await expect(page.getByLabel('Until', { exact: true })).toHaveValue('01:00');
  await expect(page.getByLabel('Departure time', { exact: true })).toHaveValue('01:30');
  const endOccurrence = page.getByRole('combobox', { name: 'Visit end: this clock time occurs twice', exact: true });
  const departureOccurrence = page.getByRole('combobox', { name: 'Flight departure: this clock time occurs twice', exact: true });
  await expect(endOccurrence).toHaveValue('later');
  await expect(departureOccurrence).toHaveValue('later');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.lounge-card').first()).toBeVisible();
  // Moving the departure to the first 01:30 is earlier than the chosen visit
  // end. The invalid window must be explained instead of silently changing it.
  await departureOccurrence.selectOption('earlier');
  await expect(page.getByRole('alert')).toContainText('Finish your lounge visit at least 30 minutes before departure.');
  await departureOccurrence.selectOption('later');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
