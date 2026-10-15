import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import type { AppData, Trip } from '../src/lib/types';
import octoberItinerary from '../tests/fixtures/itineraries/oct2026.json' with { type: 'json' };

const itinerary = octoberItinerary.trip as Trip;
const preferences = {
  ...DEFAULT_PREFERENCES,
  homeTimeZone: 'Australia/Sydney',
  planningMode: 'model' as const,
  preparationDays: 0,
};
const personalData: AppData = { schemaVersion: 1, preferences, trips: [itinerary], selectedTripId: itinerary.id };

/** Seed the real local persistence boundary; no planner or flight cards are mocked. */
async function openPersonalData(page: Page, data = personalData) {
  await page.clock.setFixedTime(new Date('2026-10-17T12:05:00.000Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New time zone. Same you.' })).toBeVisible();
  await page.evaluate(async value => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rephase', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('state', 'readwrite');
    transaction.objectStore('state').put(value, 'guest');
    transaction.objectStore('state').delete('lastAccount');
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, data);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New time zone. Same you.' })).toBeVisible();
  if (data.trips.length) await expect(page.getByRole('heading', { name: data.trips[0].name, exact: true })).toBeVisible();
}

function planDay(page: Page, date: string, zone: string) {
  return page.locator(`.day-button[data-date="${date}"][data-zone="${zone}"]`);
}

function flightCard(page: Page, id: string) {
  return page.locator(`.flight-segment-card[data-flight-id="${id}"]`);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { googleClientId: null, syncAvailable: false, flightLookupAvailable: false } }));
});

test('Today and the full plan retain all five flights with both local clocks and date-line transit days', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPersonalData(page, { ...personalData, preferences: { ...preferences, planningMode: 'rules' } });

  // The fixed instant is in QF103's gate interval. Today must show the flight,
  // even if the body-clock recommendation currently belongs to a different day.
  await expect(page.getByRole('heading', { name: 'Today, at a glance', exact: true })).toBeVisible();
  const outbound = flightCard(page, 'qf103');
  await expect(outbound).toBeVisible();
  await expect(page.locator('.action-card.current').getByRole('heading', { name: /Seated rest/ })).toBeVisible();
  const departure = outbound.locator('[aria-label="Gate departure"]');
  await expect(departure.locator('.flight-clock-origin')).toContainText('20:15');
  await expect(departure.locator('.flight-clock-origin')).toContainText('17 Oct');
  await expect(departure.locator('.flight-clock-destination')).toContainText('23:15');
  await expect(departure.locator('.flight-clock-destination')).toContainText('16 Oct');
  const arrival = outbound.locator('[aria-label="Gate arrival"]');
  await expect(arrival.locator('.flight-clock-origin')).toContainText('05:55');
  await expect(arrival.locator('.flight-clock-origin')).toContainText('18 Oct');
  await expect(arrival.locator('.flight-clock-destination')).toContainText('08:55');
  await expect(arrival.locator('.flight-clock-destination')).toContainText('17 Oct');

  await page.getByRole('button', { name: 'Explore your plan', exact: true }).click();
  for (const leg of itinerary.legs) {
    const day = planDay(page, leg.arrivalDateTime.slice(0, 10), leg.arrivalTimeZone);
    await expect(day).toHaveClass(/travel-day/);
    await expect(day).toContainText('Travel');
    await day.click();
    await expect(flightCard(page, leg.id)).toBeVisible();
    await expect(flightCard(page, leg.id)).toContainText(leg.flightNumber);
  }

  await planDay(page, '2026-10-24', 'America/Los_Angeles').click();
  await expect(flightCard(page, 'aa6276')).toBeVisible();
  await expect(flightCard(page, 'qf94')).toBeVisible();
  await planDay(page, '2026-10-25', 'Australia/Melbourne').click();
  await expect(flightCard(page, 'qf94')).toBeVisible();
  await planDay(page, '2026-10-27', 'Australia/Sydney').click();
  await expect(flightCard(page, 'qf490')).toBeVisible();
  await expect(planDay(page, '2026-10-16', 'Pacific/Honolulu')).toHaveCount(0);

  await planDay(page, '2026-10-17', 'Pacific/Honolulu').click();
  const actionClocks = page.locator('.travel-action-clocks').first();
  await expect(actionClocks).toBeVisible();
  await expect(actionClocks.locator('.travel-action-clock')).toHaveCount(2);
  await expect(actionClocks).toContainText('Origin · SYD');
  await expect(actionClocks).toContainText('Destination · HNL');
  await expect(actionClocks.locator('time')).toHaveCount(4);
  await expect(actionClocks.locator('time').first()).toHaveText(/\d{1,2} Oct \d{2}:\d{2}/);
  expect(errors).toEqual([]);
});

test('mobile travel cards and dual clocks fit a 390-pixel screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPersonalData(page);
  await expect(flightCard(page, 'qf103')).toBeVisible();
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Your plan', exact: true }).click();
  await planDay(page, '2026-10-24', 'America/Los_Angeles').click();
  await expect(flightCard(page, 'aa6276')).toBeVisible();
  await expect(flightCard(page, 'qf94')).toBeVisible();
  await expect(flightCard(page, 'qf94').locator('.flight-clock-origin')).toHaveCount(2);
  await expect(flightCard(page, 'qf94').locator('.flight-clock-destination')).toHaveCount(2);
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/travel-feedback-mobile.png' });
  await flightCard(page, 'qf94').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/travel-clocks-mobile.png' });
});

test('minute-only flight entry defaults arrival until edited and preserves existing arrival on reopening', async ({ page }) => {
  await openPersonalData(page, { schemaVersion: 1, preferences, trips: [], selectedTripId: null });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Trips', exact: true }).click();
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Plan a new journey', exact: true });
  await editor.getByLabel('Trip name').fill('Minute entry regression');
  await editor.getByLabel('Airport code').first().fill('MEL');
  await editor.getByLabel('Airport code').last().fill('SYD');
  const fields = editor.locator('input[type="datetime-local"]');
  await expect(fields).toHaveCount(4);
  for (let index = 0; index < 4; index++) await expect(fields.nth(index)).toHaveAttribute('step', '60');
  const departure = editor.getByLabel('Local departure date & time');
  const arrival = editor.getByLabel('Local arrival date & time');
  await departure.fill('2026-10-27T20:10');
  await expect(arrival).toHaveValue('2026-10-27T20:10');
  await departure.fill('2026-10-27T20:20');
  await expect(arrival).toHaveValue('2026-10-27T20:20');
  await arrival.fill('2026-10-27T21:35');
  await departure.fill('2026-10-27T20:15');
  await expect(arrival).toHaveValue('2026-10-27T21:35');
  await editor.getByRole('button', { name: 'Create my plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Minute entry regression', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Edit your journey', exact: true });
  await expect(reopened.getByLabel('Local arrival date & time')).toHaveValue('2026-10-27T21:35');
  await reopened.getByLabel('Local departure date & time').fill('2026-10-27T20:25');
  await expect(reopened.getByLabel('Local arrival date & time')).toHaveValue('2026-10-27T21:35');
  await reopened.getByRole('button', { name: 'Save & regenerate plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Minute entry regression', exact: true })).toBeVisible();
});

test('Today keeps a short daytime flight visible when no recommendation is currently active', async ({ page }) => {
  const shortTrip: Trip = {
    id: 'short-daytime-flight', name: 'Short daytime flight',
    createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
    legs: [{
      id: 'short-flight', flightNumber: 'TEST101', departureAirport: 'JFK', arrivalAirport: 'BOS',
      departureDateTime: '2026-10-17T11:30', arrivalDateTime: '2026-10-17T12:45',
      departureTimeZone: 'UTC', arrivalTimeZone: 'UTC', stayAfter: 'destination', strategy: 'adapt',
      travelClass: 'economy', lieFlat: false,
    }],
  };
  await openPersonalData(page, {
    schemaVersion: 1, preferences: { ...preferences, homeTimeZone: 'UTC', planningMode: 'rules' },
    trips: [shortTrip], selectedTripId: shortTrip.id,
  });
  await expect(page.getByRole('heading', { name: 'Today, at a glance', exact: true })).toBeVisible();
  await expect(flightCard(page, 'short-flight')).toBeVisible();
  await expect(page.locator('.action-card.current')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'This plan is complete', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Explore your plan', exact: true }).click();
  await planDay(page, '2026-10-17', 'UTC').click();
  await expect(flightCard(page, 'short-flight')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Seated rest/ })).toHaveCount(0);
  const displayedIntervals = await page.locator('.agenda-list .action-time').evaluateAll(nodes => nodes.map(node => ({
    start: node.querySelector('strong')?.textContent ?? '',
    end: node.querySelector('span')?.textContent ?? '',
  })));
  const clockMinutes = (clock: string) => {
    const match = /^(\d{2}):(\d{2})/.exec(clock);
    expect(match, `Expected a minute-resolution action clock: ${clock}`).not.toBeNull();
    return Number(match![1]) * 60 + Number(match![2]);
  };
  for (const interval of displayedIntervals) {
    const start = clockMinutes(interval.start);
    let end = clockMinutes(interval.end);
    if (end <= start) end += 24 * 60;
    expect(start < 12 * 60 + 45 && end > 11 * 60 + 30).toBe(false);
  }
});
