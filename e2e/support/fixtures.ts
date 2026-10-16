import { expect, type Page } from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../../src/lib/defaults';
import type { Account, AppData } from '../../src/lib/types';

export const emptyAppData = (): AppData => ({
  schemaVersion: 1,
  preferences: { ...DEFAULT_PREFERENCES },
  trips: [],
  selectedTripId: null,
});

/** Small stateful API fixture for ordinary signed-in journeys.
 * The account suite keeps its richer concurrency/offline/authentication fixture.
 */
export class AccountStateApi {
  data = emptyAppData();
  revision = 1;
  writes: AppData[] = [];

  constructor(
    readonly account: Account,
    readonly options: {
      flightLookupAvailable?: boolean;
      validate?: (data: AppData) => void;
    } = {},
  ) {}

  async install(page: Page) {
    await page.route('https://accounts.google.com/gsi/client', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: 'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}};',
      }),
    );
    await page.route('**/api/auth/challenge', (route) =>
      route.fulfill({ json: { nonce: 'test-nonce' } }),
    );
    await page.route('**/api/config', (route) =>
      route.fulfill({
        json: {
          googleClientId: 'test-client',
          syncAvailable: true,
          flightLookupAvailable: this.options.flightLookupAvailable ?? false,
          flightProvider: 'aerodatabox',
        },
      }),
    );
    await page.route('**/api/me', (route) => route.fulfill({ json: this.account }));
    await page.route('**/api/state', (route) => {
      expect(route.request().headers()['x-rephase-account']).toBe(this.account.id);
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { data: this.data, revision: this.revision } });
      const body = route.request().postDataJSON() as { data: AppData; revision: number };
      this.options.validate?.(body.data);
      if (body.revision !== this.revision)
        return route.fulfill({ status: 409, json: { error: 'Changed on another device' } });
      this.data = structuredClone(body.data);
      this.writes.push(this.data);
      this.revision++;
      return route.fulfill({ json: { revision: this.revision } });
    });
  }
}

/** Seed the real guest IndexedDB boundary without mocking planning. */
export async function seedGuestData(page: Page, data: AppData) {
  await page.evaluate(async (value) => {
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
}
