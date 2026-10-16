import { captureDesign } from './support/screenshots';
import { test, expect } from '@playwright/test';

test('mobile WebKit selects a city by touch and closes the time-zone list without coercing free text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { googleClientId: null, syncAvailable: false, flightLookupAvailable: false },
    }),
  );
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Profile', exact: true })
    .tap();
  const zone = page.getByRole('combobox', { name: 'Home time zone', exact: true });
  await zone.fill('Sydney');
  const choices = page.getByRole('listbox', { name: 'Time zones', exact: true });
  const sydney = choices.getByRole('option').filter({ hasText: 'Australia/Sydney' });
  await expect(sydney).toBeVisible();
  const fits = await choices.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return (
      bounds.left >= 0 &&
      bounds.right <= innerWidth &&
      element.scrollWidth <= element.clientWidth + 1
    );
  });
  expect(fits).toBe(true);
  await zone.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await captureDesign(page, 'artifacts/preferences-time-zone-webkit-mobile.png');
  await sydney.tap();
  await expect(zone).toHaveValue('Australia/Sydney');
  await expect(choices).toHaveCount(0);
  await zone.fill('Tokyo');
  await expect(choices).toBeVisible();
  await zone.press('Escape');
  await expect(choices).toHaveCount(0);
  await expect(zone).toHaveValue('Tokyo');
  await page.getByRole('heading', { name: 'Home base', exact: true }).tap();
  await expect(zone).toHaveValue('Tokyo');
  await expect(choices).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
