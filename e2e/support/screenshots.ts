import type { Locator, Page } from '@playwright/test';

/** Optional design-review captures; failure screenshots and traces stay enabled. */
export async function captureDesign(target: Page | Locator, path: string) {
  if (process.env.REPHASE_CAPTURE_SCREENSHOTS === '1') await target.screenshot({ path });
}
