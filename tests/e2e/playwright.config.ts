import { defineConfig, devices } from '@playwright/test'

/**
 * The end-to-end tests of the admin (v0.3, `vp run e2e:admin`): Chromium against the built
 * playground served by `wrangler dev` at `http://localhost:<port>` (WebAuthn takes a name, never an
 * address, as its relying party), with a virtual passkey in place of a person's device.
 * `global-setup.ts` makes the project, runs `hollware init` and starts the Worker; the tests run one
 * after another, since they share it.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  globalSetup: './global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
})
