import { defineConfig } from '@playwright/test'

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
if (!databaseUrl) {
  throw new Error('多人 E2E 需要显式设置 TEST_DATABASE_URL')
}

const roomId = process.env.MULTIPLAYER_E2E_ROOM_ID?.trim()
if (!roomId) {
  throw new Error('多人 E2E runner 未提供 MULTIPLAYER_E2E_ROOM_ID')
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'multiplayer.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  outputDir: 'artifacts/multiplayer-playwright-results',
  preserveOutput: 'always',
  reporter: [
    ['line'],
    ['json', { outputFile: 'artifacts/multiplayer-playwright-report.json' }],
    ['html', { outputFolder: 'artifacts/multiplayer-playwright-html', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'multiplayer-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: 'node dist-server/index.js',
    url: 'http://127.0.0.1:4174/readyz',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    env: {
      DATABASE_URL: databaseUrl,
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: '4174',
      DEFAULT_ROOM_ID: roomId,
      AUTO_MIGRATE: 'true',
      MAX_ROOM_PLAYERS: '12',
      TURN_ACTION_TIMEOUT_MS: '30000',
      TILT_DECISION_TIMEOUT_MS: '10000',
      END_DECISION_TIMEOUT_MS: '30000',
      MAX_AUTO_RETRIES: '5',
      SCHEDULER_POLL_INTERVAL_MS: '100',
      ROLL_REVEAL_MIN_MS: '1200',
      ROLL_REVEAL_MAX_MS: '10000',
      DB_POOL_MAX: '4',
    },
  },
})
