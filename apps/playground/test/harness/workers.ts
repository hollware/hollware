import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestHarness, type TestHarness } from 'wrangler'

/**
 * Wrangler registers every Worker it runs by name in a dev registry, which is one directory for the
 * whole machine by default. The files of these tests run at once, each with a `hollware-playground`
 * of its own, and a request could reach the one of a file that had just closed it: "Network
 * connection lost" (seen in CI, 2026-10-17). Each test process keeps its Workers in a registry of
 * its own; the Workers of one harness bind one another without it.
 */
process.env['WRANGLER_REGISTRY_PATH'] = mkdtempSync(join(tmpdir(), 'hollware-registry-'))

/**
 * The one harness pattern (the v0.1 plan): every request to Hollware goes to HOLLWARE_URL, and the
 * Hollware Worker gets it as its HOLLWARE_PUBLIC_URL, so the Host and Origin it checks are the
 * ones the tests send.
 */
export const HOLLWARE_URL = 'http://localhost'

/**
 * The Worker secret of the harness's Hollware (`HOLLWARE_SECRET`), which signs preview tokens: a
 * test makes a token the way the admin's route does, with `makePreviewToken` of `@hollware/core`.
 */
export const HARNESS_SECRET = 'h'.repeat(40)

/** The variables of the built Hollware Worker in every harness. */
const HOLLWARE_VARS = { HOLLWARE_PUBLIC_URL: HOLLWARE_URL, HOLLWARE_SECRET: HARNESS_SECRET }

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
  // The Astro adapter writes the Worker and its wrangler.json to dist/server.
  astro: new URL('../../../../examples/astro-blog/dist/server/', import.meta.url),
  // React Router's Vite build writes the Worker and its wrangler.json to build/server.
  reactRouter: new URL('../../../../examples/react-router-blog/build/server/', import.meta.url),
}

/** The built hollware.com (`apps/web`), Worker and wrangler.json, as Nuxt writes them. */
export const BUILT_WEB = new URL('../../../web/.output/server/', import.meta.url)

/** The name of hollware.com's Worker. */
export const WEB_WORKER = 'hollware-web'

/** The built Hollware Worker and hollware.com, which reads the docs over its service binding. */
export function createWebHarness() {
  return createTestHarness({
    workers: [
      {
        configPath: new URL('wrangler.json', BUILT.hollware),
        vars: HOLLWARE_VARS,
      },
      { configPath: new URL('wrangler.json', BUILT_WEB), vars: { NUXT_HOLLWARE_WEBHOOK_SECRET } },
    ],
  })
}

/** A request to hollware.com, at SITE_URL. */
export function webFetch(server: TestHarness, path: string) {
  return server.getWorker(WEB_WORKER).fetch(`${SITE_URL}${path}`)
}

/** The name of the Nuxt example's Worker (`examples/nuxt-blog`). */
export const NUXT_WORKER = 'hollware-nuxt-blog'

/** The built Hollware Worker and the Nuxt blog, which reads it over its service binding. */
export function createNuxtHarness() {
  return createTestHarness({
    workers: [
      {
        configPath: new URL('wrangler.json', BUILT.hollware),
        vars: HOLLWARE_VARS,
      },
      { configPath: new URL('wrangler.json', BUILT.nuxt), vars: { NUXT_HOLLWARE_WEBHOOK_SECRET } },
    ],
  })
}

/** The init of a request to a site: its headers, and whether it follows a redirect. */
type SiteInit = Parameters<ReturnType<TestHarness['getWorker']>['fetch']>[1]

/** The secret of Hollware's webhook to the Nuxt blog in the tests, which signs its events. */
export const NUXT_HOLLWARE_WEBHOOK_SECRET = `whsec_${'5'.repeat(64)}`

/** A request to the Nuxt blog, at SITE_URL. */
export function nuxtFetch(server: TestHarness, path: string, init?: SiteInit) {
  return server.getWorker(NUXT_WORKER).fetch(`${SITE_URL}${path}`, init)
}

/** The name of the Astro example's Worker (`examples/astro-blog`). */
export const ASTRO_WORKER = 'hollware-astro-blog'

/** The built Hollware Worker and the Astro blog, which reads it over its service binding. */
export function createAstroHarness() {
  return createTestHarness({
    workers: [
      {
        configPath: new URL('wrangler.json', BUILT.hollware),
        vars: HOLLWARE_VARS,
      },
      { configPath: new URL('wrangler.json', BUILT.astro) },
    ],
  })
}

/** A request to the Astro blog, at SITE_URL. */
export function astroFetch(server: TestHarness, path: string, init?: SiteInit) {
  return server.getWorker(ASTRO_WORKER).fetch(`${SITE_URL}${path}`, init)
}

/** The name of the React Router example's Worker (`examples/react-router-blog`). */
export const REACT_ROUTER_WORKER = 'hollware-react-router-blog'

/** The built Hollware Worker and the React Router blog, which reads it over its service binding. */
export function createReactRouterHarness() {
  return createTestHarness({
    workers: [
      {
        configPath: new URL('wrangler.json', BUILT.hollware),
        vars: HOLLWARE_VARS,
      },
      { configPath: new URL('wrangler.json', BUILT.reactRouter) },
    ],
  })
}

/** A request to the React Router blog, at SITE_URL. */
export function reactRouterFetch(server: TestHarness, path: string, init?: SiteInit) {
  return server.getWorker(REACT_ROUTER_WORKER).fetch(`${SITE_URL}${path}`, init)
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
        vars: HOLLWARE_VARS,
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

/** What miniflare answers when its connection to the Worker drops: no answer of the Worker's. */
const LOST_CONNECTION = 'Network connection lost.'

/**
 * A request sent again, once, when miniflare lost its connection to the Worker before the Worker
 * answered: a 500 whose body is miniflare's own error, with no line of the Worker's in its log.
 * Seen in CI only, about one run in three since 2026-10-17, always on one request of
 * gateway.test.ts (reported to cloudflare/workers-sdk). Any answer of the Worker, a 500 of its own
 * included, is returned as it is, and so is a second lost connection.
 */
export async function retryingLostConnection<
  Answer extends { readonly status: number; clone(): { text(): Promise<string> } },
>(send: () => Promise<Answer>, log: (message: string) => void = console.warn): Promise<Answer> {
  const first = await send()
  if (first.status !== 500) return first
  const body = await first.clone().text()
  if (!body.startsWith(`Error: ${LOST_CONNECTION}`)) return first
  log(`miniflare lost its connection to the Worker; sending the request once more`)
  return send()
}
