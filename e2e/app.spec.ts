import { captureDesign } from './support/screenshots';
import { test, expect } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../src/lib/defaults';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { googleClientId: null, syncAvailable: false } }),
  );
});

test('desktop example produces a dated plan and calendar export', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New time zone. Same you.' })).toBeVisible();
  await expect(page.getByText('Example trip', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore your plan' }).click();
  await expect(page.getByRole('heading', { name: 'Your travel plan' })).toBeVisible();
  await expect(page.getByText('All times in', { exact: false })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('rephase-plan.ics');
  expect(errors).toEqual([]);
});

test('mobile preferences persist after reload without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Profile', exact: true })
    .click();
  await page.getByLabel('Hours of sleep you need').fill('9');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Profile', exact: true })
    .click();
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByText('Google sign-in is unavailable.', { exact: false })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await captureDesign(page, 'artifacts/preview-mobile.png');
});

test('editing the example preserves keyboard focus and creates a personal itinerary', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore your plan' }).click();
  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  const name = page.getByLabel('Trip name');
  await name.fill('My personal itinerary');
  await name.press('End');
  await name.pressSequentially('!');
  await expect(name).toBeFocused();
  await page.getByLabel('Travel class').first().selectOption('business');
  await page.getByLabel('Lie-flat bed available?').first().selectOption('no');
  await page.getByRole('button', { name: 'Save & regenerate plan' }).click();
  await expect(
    page.getByRole('heading', { name: 'My personal itinerary!', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  await expect(page.getByLabel('Travel class').first()).toHaveValue('business');
  await expect(page.getByLabel('Lie-flat bed available?').first()).toHaveValue('no');
  await expect(page.getByText('Example trip', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Explore your plan' }).click();
  await expect(
    page.getByRole('heading', { name: 'My personal itinerary!', exact: true }),
  ).toBeVisible();
});

test('invalid arrival ordering is rejected and the draft remains editable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore your plan' }).click();
  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  await page
    .locator('.flight-editor-card')
    .first()
    .getByRole('button', { name: 'Enter manually', exact: true })
    .click();
  await page.getByLabel('Local arrival date & time').first().fill('2020-01-01T01:00');
  await page.getByRole('button', { name: 'Save & regenerate plan' }).click();
  await expect(
    page.getByText('Flight 1: arrival must follow departure in real time.'),
  ).toBeVisible();
  await expect(page.getByLabel('Trip name')).toBeVisible();
});

test('production shell and a saved account namespace reopen offline', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('Example trip', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.evaluate(async (preferences) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rephase', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('state', 'readwrite');
    transaction
      .objectStore('state')
      .put(
        { id: 'offline-account', name: 'Offline traveler', email: 'traveler@example.com' },
        'lastAccount',
      );
    transaction
      .objectStore('state')
      .put(
        {
          schemaVersion: 1,
          preferences: { ...preferences, sleepHours: 9.5 },
          trips: [],
          selectedTripId: null,
        },
        'account:offline-account',
      );
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, DEFAULT_PREFERENCES);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Profile', exact: true }).first().click();
  await expect(page.getByLabel('Hours of sleep you need')).toHaveValue('9.5');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /offline/i })
      .first(),
  ).toBeVisible();
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const all = await Promise.all(
      names.map(async (name) =>
        (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname),
      ),
    );
    return all.flat();
  });
  expect(cached.some((path) => path.startsWith('/api/'))).toBe(false);
  await page.goto('/science.html');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your body clock.');
});

test('static science page works without JavaScript and fits a mobile screen', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/science.html');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('#source-cdc > a')).toHaveAttribute('href', /cdc\.gov/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await captureDesign(page, 'artifacts/science-mobile.png');
  await context.close();
});

test('repeated local flight times require an explicit occurrence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Trips', exact: true }).first().click();
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  await page.getByRole('button', { name: 'Enter manually', exact: true }).click();
  await page.getByLabel('Airport code').first().fill('JFK');
  await page.getByLabel('Airport code').last().fill('BOS');
  await page.getByLabel('Local departure date & time').fill('2026-11-01T01:30');
  await page.getByLabel('Local arrival date & time').fill('2026-11-01T03:30');
  const fold = page.getByRole('combobox', { name: 'Departure: this clock time occurs twice' });
  await expect(fold).toBeVisible();
  await fold.selectOption('later');
  await page.getByRole('button', { name: 'Create my plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My next journey', exact: true })).toBeVisible();
});

test('recorded actual experience persists after reload', async ({ page }) => {
  const local = (days: number, hour: string) =>
    `${new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)}T${hour}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Trips', exact: true }).first().click();
  await page.getByRole('button', { name: 'New trip', exact: true }).click();
  await page.getByLabel('Trip name').fill('My recent flight');
  await page.getByRole('button', { name: 'Enter manually', exact: true }).click();
  await page.getByLabel('Airport code').first().fill('JFK');
  await page.getByLabel('Airport code').last().fill('LHR');
  await page.getByLabel('Departure time zone').fill('UTC');
  await page.getByLabel('Arrival time zone').fill('UTC');
  await page.getByLabel('Local departure date & time').fill(local(-3, '12:00'));
  await page.getByLabel('Local arrival date & time').fill(local(-3, '20:00'));
  await page.getByRole('button', { name: 'Create my plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My recent flight', exact: true })).toBeVisible();
  await page.locator('.day-button').first().click();
  await page.getByRole('button', { name: 'Record what happened', exact: true }).first().click();
  await page.getByRole('combobox', { name: 'What happened?' }).selectOption('missed');
  await page.getByRole('button', { name: 'Save record', exact: true }).click();
  await expect(page.getByText('Your recorded history', { exact: false })).toBeVisible();
  await page.getByText('Your recorded history', { exact: false }).click();
  await expect(
    page
      .locator('.plan-warnings')
      .filter({ hasText: 'Your recorded history' })
      .locator('li')
      .filter({ hasText: 'missed' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Explore your plan' }).click();
  await expect(page.getByText('Your recorded history', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await captureDesign(page, 'artifacts/preview-desktop.png');
});
