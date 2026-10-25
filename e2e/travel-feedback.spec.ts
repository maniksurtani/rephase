import { seedGuestData } from './support/fixtures';
import { captureDesign } from './support/screenshots';
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
const personalData: AppData = {
  schemaVersion: 1,
  preferences,
  trips: [itinerary],
  selectedTripId: itinerary.id,
};

/** Seed the real local persistence boundary; no planner or flight cards are mocked. */
async function openPersonalData(page: Page, data = personalData) {
  await page.clock.setFixedTime(new Date('2026-10-17T12:05:00.000Z'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New time zone. Same you.' })).toBeVisible();
  await seedGuestData(page, data);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New time zone. Same you.' })).toBeVisible();
  if (data.trips.length)
    await expect(
      page.getByRole('heading', { name: data.trips[0].name, exact: true }),
    ).toBeVisible();
}

function planDay(page: Page, date: string, _zone?: string) {
  return page.locator(`.day-button[data-date="${date}"]`);
}

function flightCard(page: Page, id: string) {
  return page.locator(`.flight-segment-card[data-flight-id="${id}"]`);
}

async function expectMealAdvice(page: Page, id: string) {
  const meals = flightCard(page, id).locator('.meal-plan');
  await expect(meals).toBeVisible();
  await expect(meals.locator('.meal-policy')).toHaveText(
    /Let me sleep through meal service|Meal service can fit while awake/,
  );
  const details = meals.locator('details.meal-details');
  await expect(details).toBeVisible();
  await details.getByText('Meal times & details', { exact: true }).click();
  await expect(details).toHaveAttribute('open', '');
  const windows = meals.locator('.meal-window');
  const count = await windows.count();
  for (let index = 0; index < count; index++) {
    const window = windows.nth(index);
    await expect(window).toBeVisible();
    await expect(window.locator('.meal-clock')).toHaveCount(2);
    await expect(window.locator('time')).toHaveCount(4);
    await expect(window.locator('time').first()).toHaveAttribute('datetime', /T/);
  }
  return count;
}

async function expectSanFranciscoStay(page: Page) {
  // SFO shares America/Los_Angeles with LAX. Place labels must follow the
  // itinerary airport while the clock continues to use the shared IANA zone.
  for (const date of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) {
    const day = planDay(page, date);
    await expect(day).toContainText('San Francisco');
    await expect(day).not.toContainText('Los Angeles');
    await expect(day).toHaveAttribute('title', /San Francisco/);
    await expect(day).toHaveAttribute('data-zone', 'America/Los_Angeles');
  }
  await planDay(page, '2026-10-20').click();
  await expect(page.locator('.agenda-heading .stage-label')).toHaveText('Stay in San Francisco');
  await expect(page.locator('.agenda-heading .timezone-caption')).toHaveText(
    'All times in San Francisco · PDT',
  );
  await expect(page.locator('.plan-aside .eyebrow')).toContainText('San Francisco');
  expect(
    await page.evaluate(
      () =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <=
        window.innerWidth,
    ),
  ).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { googleClientId: null, syncAvailable: false, flightLookupAvailable: false },
    }),
  );
});

test('Today and the full plan retain all five flights with both local clocks and date-line transit days', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openPersonalData(page, {
    ...personalData,
    preferences: { ...preferences, planningMode: 'rules' },
  });

  // The fixed instant is in QF103's gate interval. Today must show the flight,
  // even if the body-clock recommendation currently belongs to a different day.
  await expect(
    page.getByRole('heading', { name: 'Today, at a glance', exact: true }),
  ).toBeVisible();
  const outbound = flightCard(page, 'qf103');
  await expect(outbound).toBeVisible();
  await expect(
    page.locator('.action-card.current').getByRole('heading', { name: /Rest or nap/ }),
  ).toBeVisible();
  const flightDetails = outbound.locator('details.flight-details');
  await expect(flightDetails).not.toHaveAttribute('open', '');
  await expect(outbound.locator('[aria-label="Departure"]')).toBeHidden();
  await flightDetails.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(flightDetails).toHaveAttribute('open', '');
  const departure = outbound.locator('[aria-label="Departure"]');
  await expect(departure.locator('.flight-clock-origin')).toContainText('20:15');
  await expect(departure.locator('.flight-clock-origin')).toContainText('17 Oct');
  await expect(departure.locator('.flight-clock-destination')).toContainText('23:15');
  await expect(departure.locator('.flight-clock-destination')).toContainText('16 Oct');
  const arrival = outbound.locator('[aria-label="Arrival"]');
  await expect(arrival.locator('.flight-clock-origin')).toContainText('05:55');
  await expect(arrival.locator('.flight-clock-origin')).toContainText('18 Oct');
  await expect(arrival.locator('.flight-clock-destination')).toContainText('08:55');
  await expect(arrival.locator('.flight-clock-destination')).toContainText('17 Oct');

  await page.getByRole('button', { name: 'Explore your plan', exact: true }).click();
  // Date-line travel can have multiple source-zone days, but navigation has
  // one calendar-date tile with all of their flights and recommendations.
  for (const date of ['2026-10-17', '2026-10-19', '2026-10-24']) {
    await expect(planDay(page, date)).toHaveCount(1);
  }
  await expect(page.locator('.model-disclosure')).toHaveCount(0);
  let mealWindowCount = 0;
  for (const leg of itinerary.legs) {
    const day = planDay(page, leg.departureDateTime.slice(0, 10), leg.departureTimeZone);
    await expect(day).toHaveClass(/travel-day/);
    await expect(day).toContainText('Travel');
    await day.click();
    await expect(flightCard(page, leg.id)).toBeVisible();
    await expect(flightCard(page, leg.id)).toContainText(leg.flightNumber);
    mealWindowCount += await expectMealAdvice(page, leg.id);
  }
  expect(mealWindowCount).toBeGreaterThan(0);

  await expectSanFranciscoStay(page);

  await planDay(page, '2026-10-24', 'America/Los_Angeles').click();
  await expect(flightCard(page, 'aa6276')).toBeVisible();
  await expect(flightCard(page, 'qf94')).toBeVisible();
  await planDay(page, '2026-10-25', 'Australia/Melbourne').click();
  await expect(flightCard(page, 'qf94')).toHaveCount(0);
  await expect(
    page.locator('.timeline-entry[data-flight-id="qf94"][data-phase="continuation"]'),
  ).toBeVisible();
  await planDay(page, '2026-10-27', 'Australia/Sydney').click();
  await expect(flightCard(page, 'qf490')).toBeVisible();
  await expect(planDay(page, '2026-10-16', 'Pacific/Honolulu')).toHaveCount(0);

  await planDay(page, '2026-10-17', 'Pacific/Honolulu').click();
  await expect(flightCard(page, 'qf103').locator('.meal-policy')).toHaveText(
    'Let me sleep through meal service',
  );
  const actionClocks = page.locator('.travel-action-clocks').first();
  await expect(actionClocks).toBeVisible();
  await expect(actionClocks.locator('.travel-action-clock')).toHaveCount(2);
  await expect(actionClocks).toContainText('Origin · SYD');
  await expect(actionClocks).toContainText('Destination · HNL');
  await expect(actionClocks.locator('time')).toHaveCount(4);
  await expect(actionClocks.locator('time').first()).toHaveText(/\d{1,2} Oct \d{2}:\d{2}/);

  // Existing stored trips also need the itinerary city on Today after reopening.
  await page.clock.setFixedTime(new Date('2026-10-20T19:00:00.000Z'));
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Today, at a glance', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.timezone-caption').first()).toHaveText(
    'San Francisco local time · PDT',
  );
  expect(errors).toEqual([]);
});

test('body-clock estimates show modeled movement rather than a repeated zero', async ({ page }) => {
  await openPersonalData(page, {
    ...personalData,
    preferences: { ...preferences, preparationDays: 3 },
  });
  await page.getByRole('button', { name: 'Explore your plan', exact: true }).click();
  await planDay(page, '2026-10-14').click();
  await expect(page.locator('.phase-meter')).toHaveCount(0);
  await expect(page.locator('.phase-unavailable')).toContainText(
    'Not enough history for a daily estimate.',
  );
  const summary = page
    .locator('.plan-note-card')
    .filter({ has: page.getByRole('heading', { name: 'Estimated adjustment', exact: true }) });
  await expect(summary.getByText(/^Remaining adjustment:/)).toHaveCount(0);
  await expect(summary.getByRole('link', { name: 'How estimates work', exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByRole('heading', { name: 'Light tips', exact: true })).toBeVisible();
  const estimates: string[] = [];
  for (const date of ['2026-10-16', '2026-10-18', '2026-10-20', '2026-10-21']) {
    await planDay(page, date).click();
    const meter = page.locator('.phase-meter');
    if (await meter.count()) {
      await expect(meter).toContainText('Change today');
      await expect(summary.getByText(/^Remaining adjustment:/)).toBeVisible();
      const estimate = await meter.locator('strong').innerText();
      expect(estimate).not.toMatch(/^0\.0\b/);
      expect(estimate).toMatch(/earlier|later|Nearly steady/);
      estimates.push(estimate);
    } else {
      await expect(page.locator('.phase-unavailable')).toContainText(
        'Not enough history for a daily estimate.',
      );
    }
    await expect(page.locator('.model-disclosure')).toHaveCount(0);
  }
  expect(estimates.length).toBeGreaterThan(0);
  expect(new Set(estimates).size).toBeGreaterThan(1);
  expect(
    estimates.some((estimate) => /(?:About|Under).*\b(?:earlier|later)\b/.test(estimate)),
  ).toBe(true);
  await captureDesign(page, 'artifacts/planner-phase-desktop.png');

  // Saving an earlier observation replans only the future. Unrecorded earlier
  // advice remains visible as a plan, separate from the saved observation.
  await page.clock.setFixedTime(new Date('2026-10-18T23:13:00.000Z'));
  await planDay(page, '2026-10-14').click();
  await page.getByRole('button', { name: 'Record what happened', exact: true }).first().click();
  const record = page.getByRole('dialog', { name: 'Record your actual experience', exact: true });
  await record.getByRole('button', { name: 'Save record', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Logged sleep · completed', exact: true }),
  ).toBeVisible();

  const dates = await page
    .locator('.day-button')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-date')));
  expect(dates.slice(0, 6)).toEqual([
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
    '2026-10-19',
  ]);
  expect(new Set(dates).size).toBe(dates.length);
  await expect(planDay(page, '2026-10-18')).toContainText('Honolulu');
  await planDay(page, '2026-10-18').click();
  await expect(page.locator('.agenda-heading h2')).toHaveText('Sunday 18 October');
  await expect(page.locator('.agenda-heading .stage-label')).toHaveText('Stay in Honolulu');
  await expect(page.locator('.timeline-entry[data-guidance="sleep"]')).toBeVisible();
  await expect(page.getByText('Planned · not recorded', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('No saved recommendations for this day.', { exact: true }),
  ).toHaveCount(0);
  await captureDesign(page, 'artifacts/planner-recorded-stay-desktop.png');

  await planDay(page, '2026-10-19').click();
  await expect(flightCard(page, 'as812')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Explore your plan', exact: true }).click();
  await planDay(page, '2026-10-18').click();
  await expect(page.locator('.agenda-heading h2')).toHaveText('Sunday 18 October');
  await expect(page.locator('.timeline-entry[data-guidance="sleep"]')).toBeVisible();
  await expect(page.getByText('Planned · not recorded', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await captureDesign(page, 'artifacts/planner-recorded-stay-mobile.png');
});

test('the mobile date strip follows the current day and day arrows without moving the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPersonalData(page, {
    ...personalData,
    preferences: { ...preferences, preparationDays: 3 },
  });
  await page.clock.setFixedTime(new Date('2026-10-25T12:36:00.000Z'));
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Your plan', exact: true })
    .click();

  async function expectSelectedDateInStrip(date: string) {
    const selected = planDay(page, date);
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    // Neither a click on the date nor scrollIntoView can hide a missing app
    // scroll: read its clipped position before any interaction with the tile.
    await expect
      .poll(
        () =>
          selected.evaluate((element) => {
            const tile = element.getBoundingClientRect();
            const strip = element.parentElement!.getBoundingClientRect();
            return tile.left >= strip.left - 1 && tile.right <= strip.right + 1;
          }),
        { timeout: 5000 },
      )
      .toBe(true);
  }

  await expect(page.locator('.agenda-heading h2')).toHaveText('Sunday 25 October');
  await expectSelectedDateInStrip('2026-10-25');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await page.locator('.day-navigation').evaluate((element) => element.scrollLeft),
  ).toBeGreaterThan(0);
  await captureDesign(page, 'artifacts/planner-current-date-mobile.png');

  // Move backwards far enough to leave the initially visible dates, then
  // forwards again. Keep the arrow on screen before measuring page movement.
  for (const [direction, dates] of [
    ['Previous', ['2026-10-24', '2026-10-23', '2026-10-22', '2026-10-21']],
    ['Next', ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']],
  ] as const) {
    const arrow = page.getByRole('button', { name: `${direction} plan day`, exact: true });
    for (const date of dates) {
      await arrow.scrollIntoViewIfNeeded();
      const pageTop = await page.evaluate(() => window.scrollY);
      await arrow.click();
      await expectSelectedDateInStrip(date);
      expect(await page.evaluate(() => window.scrollY)).toBe(pageTop);
    }
  }
});

test('minute-only flight entry defaults arrival until edited and preserves existing arrival on reopening', async ({
  page,
}) => {
  await openPersonalData(page, { schemaVersion: 1, preferences, trips: [], selectedTripId: null });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Trips', exact: true })
    .click();
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Plan a new journey', exact: true });
  await editor.getByLabel('Trip name').fill('Minute entry regression');
  await editor.getByRole('button', { name: 'Enter manually', exact: true }).click();
  await editor.getByLabel('Airport code').first().fill('MEL');
  await editor.getByLabel('Airport code').last().fill('SYD');
  const fields = editor.locator('input[type="datetime-local"]');
  await expect(fields).toHaveCount(4);
  for (let index = 0; index < 4; index++)
    await expect(fields.nth(index)).toHaveAttribute('step', '60');
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
  await expect(
    page.getByRole('heading', { name: 'Minute entry regression', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Edit your journey', exact: true });
  await expect(reopened.getByLabel('Local arrival date & time')).toBeHidden();
  await reopened.getByRole('button', { name: 'Enter manually', exact: true }).click();
  await expect(reopened.getByLabel('Local arrival date & time')).toHaveValue('2026-10-27T21:35');
  await reopened.getByLabel('Local departure date & time').fill('2026-10-27T20:25');
  await expect(reopened.getByLabel('Local arrival date & time')).toHaveValue('2026-10-27T21:35');
  await reopened.getByRole('button', { name: 'Save & regenerate plan', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Minute entry regression', exact: true }),
  ).toBeVisible();
});

test('Today keeps a short daytime flight visible when no recommendation is currently active', async ({
  page,
}) => {
  const shortTrip: Trip = {
    id: 'short-daytime-flight',
    name: 'Short daytime flight',
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    legs: [
      {
        id: 'short-flight',
        flightNumber: 'TEST101',
        departureAirport: 'JFK',
        arrivalAirport: 'BOS',
        departureDateTime: '2026-10-17T11:30',
        arrivalDateTime: '2026-10-17T12:45',
        departureTimeZone: 'UTC',
        arrivalTimeZone: 'UTC',
        stayAfter: 'destination',
        strategy: 'adapt',
        travelClass: 'economy',
        lieFlat: false,
      },
    ],
  };
  await openPersonalData(page, {
    schemaVersion: 1,
    preferences: { ...preferences, homeTimeZone: 'UTC', planningMode: 'rules' },
    trips: [shortTrip],
    selectedTripId: shortTrip.id,
  });
  await expect(
    page.getByRole('heading', { name: 'Today, at a glance', exact: true }),
  ).toBeVisible();
  await expect(flightCard(page, 'short-flight')).toBeVisible();
  await expect(page.locator('.action-card.current')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'This plan is complete', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Explore your plan', exact: true }).click();
  await planDay(page, '2026-10-17', 'UTC').click();
  await expect(flightCard(page, 'short-flight')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Rest or nap/ })).toHaveCount(0);
  await expect(page.locator('.day-timeline')).toBeVisible();
  const displayedIntervals = await page
    .locator('.timeline-entry[data-kind="action"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        start: Number(node.getAttribute('data-start')),
        end: Number(node.getAttribute('data-end')),
      })),
    );
  expect(displayedIntervals.length).toBeGreaterThan(0);
  for (const interval of displayedIntervals) {
    expect(interval.end).toBeGreaterThan(interval.start);
    expect(
      interval.start < Date.parse('2026-10-17T12:45:00Z') &&
        interval.end > Date.parse('2026-10-17T11:30:00Z'),
    ).toBe(false);
  }
});
