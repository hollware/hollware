import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestHarness, type TestHarness } from 'wrangler'

process.env['WRANGLER_REGISTRY_PATH'] = mkdtempSync(join(tmpdir(), 'hollware-registry-'))

export const HOLLWARE_URL = 'http://localhost'

export const HARNESS_SECRET = 'h'.repeat(40)

const HOLLWARE_VARS = { HOLLWARE_PUBLIC_URL: HOLLWARE_URL, HOLLWARE_SECRET: HARNESS_SECRET }

export const SITE_URL = 'http://site.test'

export const HOLLWARE_WORKER = 'hollware-playground'

export const SITE_WORKER = 'hollware-worker-site'

export const PAGE_SIZE = 2

export const BUILT = {
  site: new URL('../../../../examples/worker-site/dist/hollware_worker_site/', import.meta.url),
  hollware: new URL('../../dist/hollware_playground/', import.meta.url),
  nuxt: new URL('../../../../examples/nuxt-blog/.output/server/', import.meta.url),
  astro: new URL('../../../../examples/astro-blog/dist/server/', import.meta.url),
  reactRouter: new URL('../../../../examples/react-router-blog/build/server/', import.meta.url),
}

export const BUILT_WEB = new URL('../../../web/.output/server/', import.meta.url)

export const WEB_WORKER = 'hollware-web'

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

export function webFetch(server: TestHarness, path: string) {
  return server.getWorker(WEB_WORKER).fetch(`${SITE_URL}${path}`)
}

export const NUXT_WORKER = 'hollware-nuxt-blog'

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

type SiteInit = Parameters<ReturnType<TestHarness['getWorker']>['fetch']>[1]

export const NUXT_HOLLWARE_WEBHOOK_SECRET = `whsec_${'5'.repeat(64)}`

export function nuxtFetch(server: TestHarness, path: string, init?: SiteInit) {
  return server.getWorker(NUXT_WORKER).fetch(`${SITE_URL}${path}`, init)
}

export const ASTRO_WORKER = 'hollware-astro-blog'

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

export function astroFetch(server: TestHarness, path: string, init?: SiteInit) {
  return server.getWorker(ASTRO_WORKER).fetch(`${SITE_URL}${path}`, init)
}

export const REACT_ROUTER_WORKER = 'hollware-react-router-blog'

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

export function reactRouterFetch(server: TestHarness, path: string, init?: SiteInit) {
  return server.getWorker(REACT_ROUTER_WORKER).fetch(`${SITE_URL}${path}`, init)
}

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

export function createHarnessWithoutPublicUrl() {
  const directory = mkdtempSync(join(tmpdir(), 'hollware-without-public-url-'))
  cpSync(fileURLToPath(BUILT.hollware), directory, { recursive: true })
  const configPath = join(directory, 'wrangler.json')
  const config: unknown = JSON.parse(readFileSync(configPath, 'utf8'))
  if (!isRecord(config) || !isRecord(config['vars'])) {
    throw new Error('the built wrangler.json of the playground has no vars')
  }
  delete config['vars']['HOLLWARE_PUBLIC_URL']
  delete config['assets']
  writeFileSync(configPath, JSON.stringify(config))
  return {
    server: createTestHarness({ workers: [{ configPath }] }),
    remove: () => {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

const LOST_CONNECTION = 'Network connection lost.'

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
