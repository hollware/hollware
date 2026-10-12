import { createTestHarness } from 'wrangler'

/**
 * The one harness pattern (the v0.1 plan): every request to Hollware goes to HOLLWARE_URL, and the
 * Hollware Worker gets it as its HOLLWARE_PUBLIC_URL, so the Host and Origin it checks are the
 * ones the tests send.
 */
export const HOLLWARE_URL = 'http://hollware.test'

/** The URL of the site Worker, which `server.fetch` reaches as the primary Worker. */
export const SITE_URL = 'http://site.test'

/** The name of the Hollware Worker: `server.getWorker(HOLLWARE_WORKER).fetch(...)` reaches it. */
export const HOLLWARE_WORKER = 'hollware-playground'

/**
 * The built site and Hollware Workers. The Vite build writes one directory per Worker under
 * dist/, named after the Worker; the first Worker is the primary one.
 */
export function createPlaygroundHarness() {
  return createTestHarness({
    workers: [
      { configPath: new URL('../../dist/hollware_playground_site/wrangler.json', import.meta.url) },
      {
        configPath: new URL('../../dist/hollware_playground/wrangler.json', import.meta.url),
        vars: { HOLLWARE_PUBLIC_URL: HOLLWARE_URL },
      },
    ],
  })
}
