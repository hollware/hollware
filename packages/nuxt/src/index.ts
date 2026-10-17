import type { NitroRouteConfig } from 'nitropack'
import {
  addComponent,
  addImports,
  addPlugin,
  addServerHandler,
  addServerImports,
  addServerPlugin,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'
import { PREVIEW_HEADER } from './runtime/tags.ts'

/** The options of `hollware` in nuxt.config.ts. */
export interface ModuleOptions {
  /** The key of the site in the Hollware config. Required. */
  site: string
  /**
   * The service binding to the `Hollware` entrypoint of the Hollware Worker, by its name in the
   * site's wrangler.jsonc. When the Worker has it, every read goes over it: no network, no token.
   */
  binding: string
  /**
   * The public URL of the Hollware, to read over HTTP when there is no binding: at build time on
   * another host, or a site off Cloudflare. It goes with `token`.
   */
  url?: string
  /**
   * A read token (`hw_read_`, from `hollware token create --read`). It stays on the server: pages
   * read through the site's own `/_hollware/` routes. Prefer the `NUXT_HOLLWARE_TOKEN` variable to
   * writing it here.
   */
  token?: string
  /** Whether pages carry `<meta name="generator" content="Hollware">`. */
  generator: boolean
  /**
   * The public URL of the Hollware that counts this site's page views (ADR-031), such as
   * `https://cms.example.com`: each page the reader sees is sent to its `/events`, as the site and
   * the path, with no cookie. The site's `url` in the Hollware config must be this site's origin.
   * No views are counted when it is not set.
   */
  beacon?: string
  /**
   * How the pages that read Hollware are kept (S8):
   *
   * - `'purge'`: in Cloudflare's Workers Cache, which serves them without running the Worker, each
   *   tagged with what it showed, until Hollware's webhook to `/_hollware/webhook` (signed with
   *   `NUXT_HOLLWARE_WEBHOOK_SECRET`) purges what changed: a publish, an edit or an unpublish shows
   *   in seconds everywhere. It needs `"cache": { "enabled": true }` in the site's wrangler.jsonc.
   * - a number of seconds: kept by Nitro (`swr`) in each isolate, and rendered again in the
   *   background once that old; a change shows within that time.
   *
   * Errors are never kept. Off when not set.
   */
  cache?: number | 'purge'
  /** The secret of Hollware's webhook to this site, for `cache: 'purge'`; prefer `NUXT_HOLLWARE_WEBHOOK_SECRET`. */
  webhookSecret?: string
}

export type { PageEntry } from './runtime/types.ts'

export const name = '@hollware/nuxt'

/** The routes of the site that read Hollware for its pages, on the server. */
export const ROUTES = [
  ['/_hollware/site', 'site'],
  ['/_hollware/entries/:collection', 'entries'],
  ['/_hollware/entry/:collection/:locale/:slug', 'entry'],
  ['/_hollware/translations/:collection/:group', 'translations'],
] as const

export default defineNuxtModule<ModuleOptions>({
  meta: { name, configKey: 'hollware', compatibility: { nuxt: '>=4.6.0' } },
  defaults: { site: '', binding: 'HOLLWARE', generator: true },
  setup(options, nuxt) {
    if (options.site === '') {
      throw new Error(
        '@hollware/nuxt: set hollware.site in nuxt.config.ts to the key of your site in the Hollware config.',
      )
    }
    const resolver = createResolver(import.meta.url)
    const resolve = (path: string) => resolver.resolve(path)
    // Server only: runtimeConfig outside `public` never reaches the browser.
    nuxt.options.runtimeConfig['hollware'] = {
      site: options.site,
      binding: options.binding,
      url: options.url ?? '',
      token: options.token ?? '',
      // Of Hollware's webhook, for `cache: 'purge'`: NUXT_HOLLWARE_WEBHOOK_SECRET sets it at runtime.
      webhookSecret: options.webhookSecret ?? '',
    }
    addServerImports([{ name: 'useHollware', from: resolve('./runtime/server/reader') }])
    for (const [route, handler] of ROUTES) {
      addServerHandler({
        route,
        method: 'get',
        handler: resolve(`./runtime/server/routes/${handler}`),
      })
    }
    addImports(
      ['useHollwareEntry', 'useHollwareEntries', 'useHollwareSite', 'useHollwareTranslations'].map(
        (imported) => ({ name: imported, from: resolve('./runtime/composables') }),
      ),
    )
    addComponent({
      name: 'HollwareContent',
      filePath: resolve('./runtime/components/HollwareContent'),
    })
    if (options.generator) addPlugin(resolve('./runtime/generator'))
    // Always: a page opened with a preview token is never kept, whatever `cache` is.
    addServerPlugin(resolve('./runtime/server/preview'))
    if (options.cache === 'purge') {
      addServerPlugin(resolve('./runtime/server/cache'))
      addServerHandler({
        route: '/_hollware/webhook',
        method: 'post',
        handler: resolve('./runtime/server/routes/webhook'),
      })
    }
    if (typeof options.cache === 'number' && options.cache > 0) {
      // `swr` with a number, spelled out so that the cache can vary on the preview header.
      const pages: NitroRouteConfig = {
        cache: { swr: true, maxAge: options.cache, varies: [PREVIEW_HEADER] },
      }
      const routes: NitroRouteConfig = { swr: false, cache: false }
      // The page routes of the site; a rule the site sets itself for a path still wins there.
      nuxt.options.routeRules = {
        '/**': pages,
        '/_hollware/**': routes,
        ...nuxt.options.routeRules,
      }
    }
    if (options.beacon !== undefined && options.beacon !== '') {
      // Public: the browser sends the views.
      nuxt.options.runtimeConfig.public['hollware'] = { site: options.site, beacon: options.beacon }
      addPlugin({ src: resolve('./runtime/beacon.client'), mode: 'client' })
    }
  },
})
