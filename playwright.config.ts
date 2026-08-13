import { defineConfig } from '@playwright/test'

const artifactRoot = 'artifacts'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 20_000 },
  outputDir: `${artifactRoot}/playwright-results`,
  preserveOutput: 'always',
  reporter: [
    ['line'],
    ['json', { outputFile: `${artifactRoot}/playwright-report.json` }],
    ['html', { outputFolder: `${artifactRoot}/playwright-html`, open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1920, height: 873 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: 'pnpm run preview:e2e',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
})
