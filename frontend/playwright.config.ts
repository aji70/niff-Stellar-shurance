import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the rebuilt frontend.
 *
 * E2E suites (connect wallet with a mocked wallet, quote -> purchase, file
 * claim, vote, appeal) run against a mocked backend by default so they never
 * depend on real wallets or real funds. Set E2E_BASE_URL to point the suite at
 * a staging deployment instead.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Mocked wallet + mocked backend: no real wallets or funds are used.
    storageState: undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
});
