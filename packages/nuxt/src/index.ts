import {
  addComponent,
  addImports,
  addPlugin,
  addServerHandler,
  addServerImports,
  createResolver,
  defineNuxtModule,
} from '@nuxt/kit'

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
  },
})
