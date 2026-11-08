import { seedGuestData } from './support/fixtures';
import { captureDesign } from './support/screenshots';
import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import type { AppData, Preferences, Trip } from '../src/lib/types';
import octoberItinerary from '../tests/fixtures/itineraries/oct2026.json' with { type: 'json' };

const itinerary = octoberItinerary.trip as Trip;

async function openPlan(
  page: Page,
  trip = itinerary,
  homeTimeZone = 'Australia/Sydney',
  preferences: Partial<Preferences> = {},
  now = '2026-11-03T12:00:00Z',
) {
  await page.clock.setFixedTime(new Date(now));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New time zone. Same you.' })).toBeVisible();
  const data: AppData = {
    schemaVersion: 1,
    preferences: {
      ...DEFAULT_PREFERENCES,
      homeTimeZone,
      planningMode: 'rules',
      preparationDays: 0,
      melatonin: true,
      ...preferences,
    },
    trips: [trip],
    selectedTripId: trip.id,
  };
  await seedGuestData(page, data);
  await page.reload();
  await expect(page.getByRole('heading', { name: trip.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore your plan', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { googleClientId: null, syncAvailable: false, flightLookupAvailable: false },
    }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('continuous bands preserve date-line spans, distinct clock folds, flight details and recording', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(
    page,
    { ...itinerary, createdAt: '2026-10-01T00:00:00Z', legs: itinerary.legs.slice(0, 4) },
    'Australia/Sydney',
    { planningMode: 'model', preparationDays: 3 },
  );
  const journey = page.locator('.journey-timeline');
  await expect(journey).toBeVisible();
  const dates = await page
    .locator('.day-button')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-date')));
  expect(new Set(dates).size).toBe(dates.length);
  expect(dates).toContain('2026-10-18');
  expect(dates.at(-1)).toBe('2026-10-27');
  const qf94 = page.locator('.journey-flight-span[data-flight-id="qf94"]');
  await expect(qf94).toHaveCount(1);
  const fold = page.locator('.journey-clock-fold').filter({ hasText: 'Melbourne' });
  await expect(fold).toHaveCount(1);
  await expect(fold).toContainText('25 Oct');
  await expect(fold).toContainText('26 Oct');
  await expect(fold).toContainText('+18h');
  await expect(fold).toHaveAttribute('role', 'note');
  const at = Number(await fold.getAttribute('data-at'));
  expect(at).toBeGreaterThan(Number(await qf94.getAttribute('data-start')));
  expect(at).toBeLessThan(Number(await qf94.getAttribute('data-end')));
  await expect(page.locator('.journey-midnight').filter({ hasText: '25 Oct' })).toHaveCount(1);
  const sleep = await page
    .locator('.journey-band[data-kind="rest"], .journey-band[data-kind="sleep"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        start: Number(n.getAttribute('data-start')),
        end: Number(n.getAttribute('data-end')),
      })),
    );
  expect(sleep.some((s) => s.start < at && s.end > at)).toBe(true);
  const bandGap = await journey.evaluate((el) => {
    const bands = [...el.querySelectorAll('.journey-band')].map((b) => b.getBoundingClientRect());
    return Math.min(
      ...[...el.querySelectorAll('.journey-flight-marker')].flatMap((e) =>
        bands.map((b) => e.getBoundingClientRect().left - b.right),
      ),
    );
  });
  expect(bandGap).toBeGreaterThan(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await fold.scrollIntoViewIfNeeded();
  await captureDesign(page, 'artifacts/continuous-clock-fold-mobile.png');

  await page
    .locator('.journey-flight-marker[data-flight-id="qf94"][data-phase="departure"]')
    .click();
  const details = page.getByRole('dialog', { name: 'Your flight', exact: true });
  await details.locator('.flight-details > summary').click();
  await expect(details.locator('.flight-clock-origin')).toHaveCount(2);
  await expect(details.locator('.flight-clock-destination')).toHaveCount(2);
  await details.locator('.meal-details > summary').click();
  await expect(details.locator('.meal-reason')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);

  await page.locator('.journey-band[data-kind="sleep"]').first().click();
  const guidance = page.getByRole('dialog', { name: 'Sleep', exact: true });
  await guidance.getByRole('button', { name: 'Why this helps', exact: true }).first().click();
  await expect(guidance.locator('.action-explanation').first()).toBeVisible();
  await guidance.getByRole('button', { name: 'Record what happened', exact: true }).first().click();
  const record = page.getByRole('dialog', { name: 'Record your actual experience', exact: true });
  await expect(record.getByRole('combobox', { name: 'What happened?' })).toBeVisible();
  await record.getByRole('button', { name: 'Cancel', exact: true }).click();
  await guidance.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Key', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Reading your timeline' })).toContainText(
    'Both clocks show the same instant',
  );
  await page.keyboard.press('Escape');
});

test('current time and scrolling keep date navigation in view without replacing the journey', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(
    page,
    itinerary,
    'Australia/Sydney',
    { preparationDays: 3 },
    '2026-10-22T19:00:00Z',
  );
  const selected = page.locator('.day-button[aria-pressed="true"]');
  await expect(selected).toHaveAttribute('data-date', '2026-10-22');
  expect(
    await selected.evaluate((el) => {
      const a = el.getBoundingClientRect(),
        b = el.parentElement!.getBoundingClientRect();
      return a.left >= b.left - 1 && a.right <= b.right + 1;
    }),
  ).toBe(true);
  await expect(page.locator('.journey-context')).toContainText('San Francisco');
  const viewport = page.locator('.journey-viewport');
  const canvasHeight = await page.locator('.journey-canvas').getAttribute('style');
  await page.locator('.day-button[data-date="2026-10-24"]').click();
  await expect(selected).toHaveAttribute('data-date', '2026-10-24');
  await expect(page.locator('.journey-canvas')).toHaveAttribute('style', canvasHeight!);
  await viewport.evaluate((el) => {
    const target = el.querySelectorAll<HTMLElement>('.journey-midnight, .journey-clock-fold');
    const day = [...target].find((n) => n.textContent?.includes('26 Oct'))!;
    el.scrollTo({ top: parseFloat(day.style.top), behavior: 'instant' });
  });
  await expect(selected).toHaveAttribute('data-date', '2026-10-26');
  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await expect(selected).toHaveAttribute('data-date', '2026-10-22');
  const instant = await page.locator('.journey-now').boundingBox();
  const bounds = await viewport.boundingBox();
  expect(instant!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(instant!.y).toBeLessThan(bounds!.y + bounds!.height);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await captureDesign(page, 'artifacts/continuous-bands-desktop.png');
});
