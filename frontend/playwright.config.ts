import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for NiffyInsur e2e tests.
 *
 * Local dev:
 *   npx playwright test          — run all tests headless
 *   npx playwright test --ui     — interactive UI mode
 *   npx playwright show-report   — open last HTML report
 *
 * CI: tests run headless; traces and screenshots are uploaded as artifacts
 * on failure (see .github/workflows/ci.yml playwright job).
 *
 * Flake policy:
 *   - Each test is retried up to 2 times in CI (0 retries locally).
 *   - Tests that remain flaky after 2 retries must be quarantined in
 *     e2e/quarantine/ and tracked in a GitHub issue within 48 hours.
 *   - Hard waits (page.waitForTimeout) are forbidden; use expect polling.
 *   - Prefer data-testid selectors over CSS/text to reduce selector churn.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',

  /* Fail fast in CI; run all locally */
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,

  /* Reporter: list in CI (machine-readable), HTML locally */
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['html', { open: 'on-failure' }]],

  use: {
    baseURL: BASE_URL,
    /* Capture trace on first retry so failures are debuggable */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    /* Video on first retry */
    video: 'on-first-retry',
    /* Reasonable action timeout — avoids hard waits */
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start the Next.js dev server automatically when running locally.
   * In CI the server is started separately before the Playwright job. */
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
