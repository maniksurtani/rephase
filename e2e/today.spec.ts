import { test, expect, type Page } from '@playwright/test';
import { AccountStateApi } from './support/fixtures';
import { captureDesign } from './support/screenshots';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';
import type { Trip } from '../src/lib/types';
import octoberItinerary from '../tests/fixtures/itineraries/oct2026.json' with { type: 'json' };

test.use({ timezoneId: 'Pacific/Honolulu', viewport: { width: 390, height: 844 } });

async function openToday(page: Page, instant: string) {
  const trip = structuredClone(octoberItinerary.trip) as Trip;
  const api = new AccountStateApi({
    id: 'today-traveler',
    name: 'Today traveler',
    email: 'today@example.com',
  });
  api.data = {
    schemaVersion: 1,
    preferences: {
      ...DEFAULT_PREFERENCES,
      homeTimeZone: 'Australia/Sydney',
      planningMode: 'rules',
      preparationDays: 0,
    },
    trips: [trip],
    selectedTripId: trip.id,
  };
  await api.install(page);
  await page.clock.setFixedTime(new Date(instant));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: trip.name, exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Today, at a glance', exact: true }),
  ).toBeVisible();
}

async function expectOnlyCurrentAndFutureCards(page: Page, instant: string) {
  const cards = page.locator('.today-section .action-card');
  await expect(cards.first()).toBeVisible();
  const intervals = await cards.evaluateAll((nodes) =>
    nodes.map((node) => ({
      start: Number(node.getAttribute('data-start')),
      end: Number(node.getAttribute('data-end')),
    })),
  );
  for (const [index, interval] of intervals.entries()) {
    expect(interval.end).toBeGreaterThan(Date.parse(instant));
    if (index) expect(interval.start).toBeGreaterThanOrEqual(intervals[index - 1].start);
  }
}

test('Today removes elapsed morning advice using the device clock, including immediately after a background resume', async ({
  page,
}) => {
  // Absolute instants deliberately cross the UTC date boundary: both clocks
  // below are Sunday 18 October in Honolulu, not the UTC calendar date.
  await openToday(page, '2026-10-18T18:30:00Z'); // 08:30 HST
  const today = page.locator('.today-section');
  await expect(
    today.getByRole('heading', { name: 'Optional caffeine', exact: true }),
  ).toBeVisible();
  await expect(
    today.getByRole('heading', { name: 'Seek bright light', exact: true }),
  ).toBeVisible();
  await expect(today.locator('.action-card.current')).toHaveCount(2);
  await expectOnlyCurrentAndFutureCards(page, '2026-10-18T18:30:00Z');

  // Simulate iOS suspending the page rather than running hours of interval
  // callbacks. The visibility event must refresh the clock on return.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.setFixedTime(new Date('2026-10-19T01:45:00Z')); // 15:45 HST
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(today.getByRole('heading', { name: 'Optional caffeine', exact: true })).toHaveCount(
    0,
  );
  await expect(today.getByRole('heading', { name: 'Seek bright light', exact: true })).toHaveCount(
    0,
  );
  await expect(today.getByRole('heading', { name: 'Bedtime', exact: true })).toBeVisible();
  await expectOnlyCurrentAndFutureCards(page, '2026-10-19T01:45:00Z');

  // Opening at 15:45 must use the same device time before any minute tick.
  await page.reload();
  await expectOnlyCurrentAndFutureCards(page, '2026-10-19T01:45:00Z');
  await expect(page.locator('.today-section .action-card')).toHaveCount(1);
  await today.scrollIntoViewIfNeeded();
  await captureDesign(page, 'artifacts/today-current-afternoon-mobile.png');

  // Only the summary is filtered; the full plan retains historical advice.
  await page.getByRole('button', { name: 'Explore your plan', exact: true }).click();
  await page.locator('.day-button[data-date="2026-10-18"]').click();
  await expect(page.locator('.day-timeline .timeline-clock time').first()).toHaveAttribute(
    'datetime',
    '2026-10-18T10:00:00.000Z',
  );
  await expect(
    page.locator('.day-timeline').getByRole('heading', { name: 'Optional caffeine', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.day-timeline').getByRole('heading', { name: 'Seek bright light', exact: true }),
  ).toBeVisible();
});

test('Today uses Honolulu’s calendar date across UTC midnight without hiding the next bedtime', async ({
  page,
}) => {
  await openToday(page, '2026-10-18T01:45:00Z'); // Saturday 17 October, 15:45 HST
  await expectOnlyCurrentAndFutureCards(page, '2026-10-18T01:45:00Z');
  // QF103 arrived at 08:55 HST that morning and belongs in the full plan.
  await expect(
    page.locator('.today-section .flight-segment-card[data-flight-id="qf103"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('.today-section').getByRole('heading', { name: 'Bedtime', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Explore your plan', exact: true }).click();
  await page.locator('.day-button[data-date="2026-10-18"]').click();
  await expect(
    page.locator('.day-timeline').getByRole('heading', { name: 'Bedtime', exact: true }).first(),
  ).toBeVisible();
});
