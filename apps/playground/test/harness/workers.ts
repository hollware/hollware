import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestHarness, type TestHarness } from 'wrangler'

/**
 * The one harness pattern (the v0.1 plan): every request to Hollware goes to HOLLWARE_URL, and the
 * Hollware Worker gets it as its HOLLWARE_PUBLIC_URL, so the Host and Origin it checks are the
 * ones the tests send.
 */
export const HOLLWARE_URL = 'http://localhost'

/** The URL the tests give the site Worker; `siteFetch` sends the request to it. */
export const SITE_URL = 'http://site.test'

/** The name of the Hollware Worker, which is the primary Worker: `server.fetch` reaches it. */
export const HOLLWARE_WORKER = 'hollware-playground'

/** The name of the example site's Worker: `server.getWorker(SITE_WORKER)` reaches it. */
export const SITE_WORKER = 'hollware-worker-site'

/** The entries on a page of the site's blog index in the tests: a tag of three takes two pages. */
export const PAGE_SIZE = 2

/**
 * The built Workers. Each project builds itself with `vp build`, and the Vite plugin writes the
 * Worker to a directory named after it under that project's dist/: the Hollware Worker is the
 * playground's own, and the site is `examples/worker-site`, a project of its own.
 */
export const BUILT = {
  site: new URL('../../../../examples/worker-site/dist/hollware_worker_site/', import.meta.url),
  hollware: new URL('../../dist/hollware_playground/', import.meta.url),
  // Nuxt's Cloudflare preset writes the Worker and its wrangler.json to .output/server.
  nuxt: new URL('../../../../examples/nuxt-blog/.output/server/', import.meta.url),
}

/** The name of the Nuxt example's Worker (`examples/nuxt-blog`). */
export const NUXT_WORKER = 'hollware-nuxt-blog'

/** The built Hollware Worker and the Nuxt blog, which reads it over its service binding. */
export function createNuxtHarness() {
  return createTestHarness({
    workers: [
      {
        configPath: new URL('wrangler.json', BUILT.hollware),
        vars: { HOLLWARE_PUBLIC_URL: HOLLWARE_URL },
      },
      { configPath: new URL('wrangler.json', BUILT.nuxt) },
    ],
  })
}

/** A request to the Nuxt blog, at SITE_URL. */
export function nuxtFetch(server: TestHarness, path: string) {
  return server.getWorker(NUXT_WORKER).fetch(`${SITE_URL}${path}`)
}

/**
 * The built Hollware and site Workers, bound the way a deployment binds them: the site reaches
 * Hollware over its service binding, by the Worker's name.
 *
 * Hollware is the primary Worker, so `server.fetch(`${HOLLWARE_URL}/...`)` reaches it with the
 * Host header that URL names, which its guard compares with HOLLWARE_PUBLIC_URL. A request sent
 * straight to a Worker (`server.getWorker(name).fetch`) carries the Host of the harness's own
 * socket instead, so only the site, which checks no Host, is reached that way (`siteFetch`).
 */
export function createPlaygroundHarness() {
  return createTestHarness({
    workers: [
      {
        configPath: new URL('wrangler.json', BUILT.hollware),
        vars: { HOLLWARE_PUBLIC_URL: HOLLWARE_URL },
      },
      { configPath: new URL('wrangler.json', BUILT.site), vars: { PAGE_SIZE } },
    ],
  })
}

/** A request to the example site, at SITE_URL. */
export function siteFetch(
  server: TestHarness,
  path: string,
  init?: Parameters<TestHarness['fetch']>[1],
) {
  return server.getWorker(SITE_WORKER).fetch(`${SITE_URL}${path}`, init)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The built Hollware Worker alone, in a deployment that forgot `HOLLWARE_PUBLIC_URL`. A test cannot
 * remove a variable through the harness, so this runs a copy of the build whose config does not
 * declare it. Call `remove()` when the test is over.
 */
export function createHarnessWithoutPublicUrl() {
  const directory = mkdtempSync(join(tmpdir(), 'hollware-without-public-url-'))
  cpSync(fileURLToPath(BUILT.hollware), directory, { recursive: true })
  const configPath = join(directory, 'wrangler.json')
  const config: unknown = JSON.parse(readFileSync(configPath, 'utf8'))
  if (!isRecord(config) || !isRecord(config['vars'])) {
    throw new Error('the built wrangler.json of the playground has no vars')
  }
  delete config['vars']['HOLLWARE_PUBLIC_URL']
  // The admin's files stay next to the build, where this copy cannot reach them.
  delete config['assets']
  writeFileSync(configPath, JSON.stringify(config))
  return {
    server: createTestHarness({ workers: [{ configPath }] }),
    remove: () => {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
