import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import type { AppData, Trip } from '../src/lib/types';
import octoberItinerary from '../tests/fixtures/itineraries/oct2026.json' with { type: 'json' };

const itinerary = octoberItinerary.trip as Trip;

async function openPlan(page: Page, trip = itinerary, homeTimeZone = 'Australia/Sydney') {
  await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New time zone. Same you.' })).toBeVisible();
  const data: AppData = {
    schemaVersion: 1,
    preferences: { ...DEFAULT_PREFERENCES, homeTimeZone, planningMode: 'rules', preparationDays: 0, melatonin: true },
    trips: [trip], selectedTripId: trip.id,
  };
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
  await expect(page.getByRole('heading', { name: trip.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore your plan', exact: true }).click();
}

async function intervals(page: Page, selector: string) {
  return page.locator(selector).evaluateAll(nodes => nodes.map(node => ({
    start: Number(node.getAttribute('data-start')),
    end: Number(node.getAttribute('data-end')),
  })));
}

async function expectChronologicalRail(page: Page) {
  await expect(page.locator('.day-timeline')).toBeVisible();
  const rows = await intervals(page, '.timeline-step:not(.timeline-end)');
  expect(rows.length).toBeGreaterThan(2);
  for (const [index, row] of rows.entries()) {
    expect(Number.isFinite(row.start)).toBe(true);
    expect(row.end).toBeGreaterThan(row.start);
    if (index) expect(row.start).toBe(rows[index - 1].end);
  }
  const entries = await intervals(page, '.timeline-entry');
  expect(entries.length).toBeGreaterThan(0);
  for (const [index, entry] of entries.entries()) {
    expect(entry.end).toBeGreaterThanOrEqual(entry.start);
    if (index) expect(entry.start).toBeGreaterThanOrEqual(entries[index - 1].start);
  }
  return rows;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { googleClientId: null, syncAvailable: false, flightLookupAvailable: false } }));
});

test('daily timeline shows concurrent duration bands and keeps explanation and recording controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openPlan(page);
  await page.locator('.day-button[data-date="2026-10-20"]').click();
  const rows = await expectChronologicalRail(page);
  expect(rows.at(-1)!.end - rows[0].start).toBe(24 * 3_600_000);
  for (const kind of ['awake', 'sleep', 'light', 'caffeine', 'melatonin']) {
    await expect(page.locator(`.timeline-band[data-kind="${kind}"]`).first()).toBeVisible();
  }
  // Caffeine can coincide with awake time. Independent lanes preserve both
  // recommendations rather than treating overlapping cards as sequential time.
  const simultaneous = page.locator('.timeline-step:has(.timeline-band[data-kind="caffeine"]):has(.timeline-band[data-kind="awake"])').first();
  await expect(simultaneous).toBeVisible();
  const [caffeine, awake] = await Promise.all([
    simultaneous.locator('.timeline-band[data-kind="caffeine"]').boundingBox(),
    simultaneous.locator('.timeline-band[data-kind="awake"]').boundingBox(),
  ]);
  expect(caffeine).not.toBeNull();
  expect(awake).not.toBeNull();
  expect(caffeine!.x).toBeGreaterThan(awake!.x);
  expect(caffeine!.y).toBe(awake!.y);
  expect(caffeine!.height).toBe(awake!.height);
  // Detail cards may expand their rows. Among continuation-only rows, a
  // multi-hour interval must visibly occupy more space than a short interval.
  const gaps = await page.locator('.timeline-step:not(.timeline-end):not(:has(.timeline-entry))').evaluateAll(nodes => nodes.map(node => ({
    minutes: (Number(node.getAttribute('data-end')) - Number(node.getAttribute('data-start'))) / 60_000,
    height: node.getBoundingClientRect().height,
  })));
  const longGap = gaps.find(gap => gap.minutes >= 120);
  const shortGap = gaps.find(gap => gap.minutes <= 90);
  expect(longGap).toBeDefined();
  expect(shortGap).toBeDefined();
  expect(longGap!.height).toBeGreaterThan(shortGap!.height);
  const sleepIntervals = await intervals(page, '.timeline-band[data-kind="sleep"]');
  const awakeIntervals = await intervals(page, '.timeline-band[data-kind="awake"]');
  for (const sleep of sleepIntervals) for (const awake of awakeIntervals) {
    expect(sleep.start < awake.end && sleep.end > awake.start).toBe(false);
  }
  await expect(page.locator('.day-timeline .action-time').first()).toBeHidden();

  const action = page.locator('.timeline-entry .action-card').first();
  await action.getByRole('button', { name: 'Why this helps', exact: true }).click();
  await expect(action.locator('.action-explanation')).toBeVisible();
  await action.getByRole('button', { name: 'Record what happened', exact: true }).click();
  const record = page.getByRole('dialog', { name: 'Record your actual experience', exact: true });
  await expect(record.getByRole('combobox', { name: 'What happened?' })).toBeVisible();
  await record.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(record).toHaveCount(0);
  await page.locator('.day-timeline').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/timeline-stay-desktop.png' });
});

test('mobile timeline retains date-line flights, simultaneous rest, two-flight days and meal details', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page);
  await page.locator('.day-button[data-date="2026-10-17"]').click();
  await expectChronologicalRail(page);
  await expect(page.locator('.timeline-step:has(.timeline-band[data-kind="flight"]):has(.timeline-band[data-kind="rest"])').first()).toBeVisible();
  const outbound = page.locator('.day-timeline [data-flight-id="qf103"]');
  await expect(outbound).toHaveCount(1);
  const departure = outbound.getByRole('region', { name: 'Departure', exact: true });
  await expect(departure.locator('.flight-clock-origin')).toContainText('17 Oct');
  await expect(departure.locator('.flight-clock-destination')).toContainText('16 Oct');

  await page.locator('.day-button[data-date="2026-10-24"]').click();
  await expectChronologicalRail(page);
  await expect(page.locator('.day-timeline [data-flight-id="aa6276"]')).toHaveCount(1);
  const flight = page.locator('.day-timeline [data-flight-id="qf94"]');
  await expect(flight).toHaveCount(1);
  await expect(flight.locator('.flight-clock-origin')).toHaveCount(2);
  await expect(flight.locator('.flight-clock-destination')).toHaveCount(2);
  await expect(flight.locator('.meal-policy')).toBeVisible();
  const details = flight.locator('.meal-details');
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('.meal-reason')).toBeVisible();
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth)).toBe(true);
  await details.locator('summary').click();
  await expect(details).not.toHaveAttribute('open', '');
  await flight.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/timeline-flight-mobile.png' });

  await page.locator('.day-button[data-date="2026-10-20"]').click();
  await page.locator('.day-timeline').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/timeline-stay-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.day-timeline').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/timeline-stay-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.locator('.day-button[data-date="2026-10-25"]').click();
  await expectChronologicalRail(page);
  await expect(page.locator('.day-timeline [data-flight-id="qf94"]')).toHaveCount(1);
});

test('repeated daylight-saving hour remains a 25-hour chronological day with a 90-minute flight', async ({ page }) => {
  const trip: Trip = {
    id: 'dst-fall-back', name: 'Daylight saving flight',
    createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z',
    legs: [{
      id: 'dst-flight', flightNumber: 'TEST101', departureAirport: 'JFK', arrivalAirport: 'BOS',
      departureDateTime: '2026-11-01T01:15', arrivalDateTime: '2026-11-01T01:45',
      departureTimeZone: 'America/New_York', arrivalTimeZone: 'America/New_York',
      departureDisambiguation: 'earlier', arrivalDisambiguation: 'later',
      stayAfter: 'destination', strategy: 'adapt', travelClass: 'economy', lieFlat: false,
    }],
  };
  await openPlan(page, trip, 'America/New_York');
  await page.locator('.day-button[data-date="2026-11-01"]').click();
  const rows = await expectChronologicalRail(page);
  expect(rows[0].start).toBe(Date.parse('2026-11-01T04:00:00Z'));
  expect(rows.at(-1)!.end).toBe(Date.parse('2026-11-02T05:00:00Z'));
  expect(rows.at(-1)!.end - rows[0].start).toBe(25 * 3_600_000);
  await expect(page.locator('.timeline-heading')).toContainText(/EDT|GMT[−-]4/);
  await expect(page.locator('.timeline-heading')).toContainText(/EST|GMT[−-]5/);
  const entries = await intervals(page, '.timeline-entry[data-kind="flight"]');
  expect(entries).toEqual([{ start: Date.parse('2026-11-01T05:15:00Z'), end: Date.parse('2026-11-01T06:45:00Z') }]);
  const flight = page.locator('.day-timeline [data-flight-id="dst-flight"]');
  await expect(flight.locator('[aria-label="Departure"] .flight-clock-origin')).toContainText('01:15');
  await expect(flight.locator('[aria-label="Departure"] .flight-clock-origin')).toContainText(/EDT|GMT[−-]4/);
  await expect(flight.locator('[aria-label="Arrival"] .flight-clock-destination')).toContainText('01:45');
  await expect(flight.locator('[aria-label="Arrival"] .flight-clock-destination')).toContainText(/EST|GMT[−-]5/);
});
