import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
  testDir:'./e2e',
  fullyParallel:false,
  workers:1,
  timeout:120_000,
  expect:{timeout:30_000},
  use:{
    baseURL:'http://127.0.0.1:4173',
    browserName:'chromium',
    launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),args:['--no-sandbox','--disable-gpu']},
    screenshot:'only-on-failure',
    trace:'retain-on-failure',
  },
  webServer:{command:'npm run preview -- --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI,timeout:30_000},
});
