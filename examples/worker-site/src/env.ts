import type { HollwareRpc } from '@hollware/server'

/**
 * The bindings and variables of this Worker, as wrangler.jsonc declares them.
 *
 * `HOLLWARE` is typed as `HollwareRpc`, the read-only surface of Hollware: four methods, none that
 * writes. `wrangler types` cannot see across Workers, and Cloudflare's `Service<...>` type turns
 * every answer that holds `unknown` (the frontmatter of an entry, its document) into `never`, so
 * the interface itself is the honest type of what the binding is called through.
 *
 * Only a type comes from `@hollware/server`: the site never bundles the server.
 */
export interface SiteEnv {
  readonly HOLLWARE: HollwareRpc
  /** The key of the site in Hollware's hollware.config.ts. */
  readonly HOLLWARE_SITE: string
  /** The entries on a page of the blog index. */
  readonly PAGE_SIZE: number
}
