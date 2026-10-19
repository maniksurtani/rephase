import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright-core';
import { buildMobileEngine, engineOutput } from './build-mobile-engine.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await buildMobileEngine();
const script = await readFile(engineOutput, 'utf8');
const fixture = JSON.parse(
  await readFile(resolve(root, 'tests/fixtures/itineraries/oct2026.json'), 'utf8'),
);
const runtime = { Intl, Date, TextEncoder, TextDecoder, structuredClone, crypto: webcrypto };
runInNewContext(script, runtime);
const { defaultPreferences } = runtime.RephaseMobile.call('bootstrap');
const payload = {
  trip: fixture.trip,
  preferences: { ...defaultPreferences, homeTimeZone: 'Australia/Sydney' },
  now: Date.parse('2026-10-18T23:13:00Z'),
};
const expected = JSON.parse(JSON.stringify(runtime.RephaseMobile.call('plan', payload)));
const browser = await chromium.launch(
  existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {},
);
try {
  const page = await browser.newPage();
  const requests = [];
  const csp =
    "default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  await page.route('**/*', async (route) => {
    requests.push(route.request().url());
    if (route.request().url() !== 'https://offline.rephase.invalid/') return route.abort();
    await route.fulfill({
      contentType: 'text/html',
      headers: { 'Content-Security-Policy': csp },
      body: `<!doctype html><meta charset="utf-8"><script>${script.replace(/<\/script/gi, '<\\/script')}</script>`,
    });
  });
  await page.goto('https://offline.rephase.invalid/');
  const actual = await page.evaluate((input) => window.RephaseMobile.call('plan', input), payload);
  assert.deepEqual(actual.plan, expected.plan);
  assert.equal(actual.days.find((day) => day.date === '2026-10-18').city, 'Honolulu');
  assert.equal(actual.days.find((day) => day.date === '2026-10-20').city, 'San Francisco');
  const gap = await page.evaluate(() =>
    window.RephaseMobile.call('localTime', {
      dateTime: '2026-03-08T02:30',
      timeZone: 'America/New_York',
    }),
  );
  assert.equal(gap.valid, false);
  assert.deepEqual(requests, ['https://offline.rephase.invalid/']);
  console.log(
    'Bundled mobile planner matches the shared TypeScript engine in Chromium; airport clocks, DST and offline-only execution verified.',
  );
} finally {
  await browser.close();
}
