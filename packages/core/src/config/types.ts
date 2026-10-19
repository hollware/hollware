import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import type { Contract } from '../contracts/types.ts'

/**
 * The shapes of `hollware.config.ts`. The config holds the sites of the deployment, and each site
 * its collections; `describe_site` shows all of it to agents.
 */

/**
 * A schema Hollware can validate with and show to agents: a Standard Schema that also converts to
 * JSON Schema. Zod 4.2 or later is one; any other library that implements both works too.
 */
export type DescribedSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> &
  StandardJSONSchemaV1<Input, Output>

/** What a schema returns once it accepts a value. */
export type SchemaOutput<Schema extends DescribedSchema> = StandardSchemaV1.InferOutput<Schema>

/** A component an entry may use in its body, such as `::callout{type="tip"}`. */
export interface ComponentDefinition {
  /** Validates the props. It should reject unknown keys (ADR-020). */
  readonly props: DescribedSchema
  /** What the component is for, as `describe_site` shows it. */
  readonly description?: string
  /** An example of its use in Markdown, as `describe_site` shows it. */
  readonly example?: string
}

/**
 * A kind of entry of a site: a blog, docs pages, talks. It is generic over its schema, so that
 * its contracts see the frontmatter the schema returns.
 */
export interface CollectionDefinition<Schema extends DescribedSchema = DescribedSchema> {
  /** The frontmatter every entry must have; `describe_site` shows it as JSON Schema. */
  readonly schema: Schema
  /**
   * The public path of an entry in each locale of the site, with `:slug`:
   * `{ es: '/blog/:slug/', en: '/en/blog/:slug/' }`. Links that match one are internal links.
   */
  readonly routes: Readonly<Record<string, string>>
  /**
   * Translations: the frontmatter field that holds the key the translations of an entry share.
   * Without it, the entries of the collection have no translations.
   */
  readonly translations?: { readonly groupBy: string }
  /** The frontmatter field that holds the entry's tags, an array of strings. */
  readonly tags?: string
  /**
   * The frontmatter field, an ISO 8601 date, that orders the published entries in listings,
   * newest first. Without it, they follow the date of their first publication.
   */
  readonly sortBy?: string
  /** The components the body may use. Any other component is an error (ADR-020). */
  readonly components?: Readonly<Record<string, ComponentDefinition>>
  /**
   * Rules of the collection. The schema, the components, content safety and the size limit are
   * checked anyway.
   */
  readonly contracts?: readonly Contract<SchemaOutput<Schema>>[]
  /** The largest Markdown file accepted, in UTF-8 bytes. 512 KiB when absent. */
  readonly maxMarkdownBytes?: number
  /** Guidance for whoever writes in this collection, in Markdown. */
  readonly styleGuide?: string
}

/** A site of the deployment. */
export interface SiteDefinition {
  /** Its locales, such as `['es', 'en']`. */
  readonly locales: readonly [string, ...string[]]
  readonly defaultLocale: string
  readonly collections: Readonly<Record<string, CollectionDefinition>>
  /** Guidance for whoever writes anywhere in the site, in Markdown. */
  readonly styleGuide?: string
  /** The public origin of the site, such as `https://example.com`: entries' URLs start with it. */
  readonly url?: string
  /**
   * The origins whose pages may read the published content of the site from the browser, over
   * the read API with a read token (`hw_read_`). None by default.
   */
  readonly cors?: { readonly origins: readonly string[] }
  /** Who hears about publications (ADR-025). */
  readonly events?: {
    /** Each gets every event, signed with HMAC-SHA256 by the Worker secret named in `secret`. */
    readonly webhooks?: readonly {
      readonly name: string
      readonly url: string
      /** The Worker secret that signs; Hollware's own sealed one when it is left out. */
      readonly secret?: string
    }[]
    /** Tells IndexNow the URLs that changed; `key` is the key itself, which is public. */
    readonly indexNow?: { readonly key: string }
  }
  /** What the site's activity log keeps (ADR-037): no addresses, and forever, by default. */
  readonly audit?: {
    /** `hashed` keeps a keyed hash of the address of each request; `off` keeps nothing of it. */
    readonly ipAddresses?: 'off' | 'hashed'
    /** How many days a line is kept, 30 to 3650; `null` keeps the log as long as the site. */
    readonly retentionDays?: number | null
  }
  /** The daily backups of the site to the R2 bucket: each day, kept 30 days, by default. */
  readonly backups?: {
    /** `false` makes no backup; those already kept go when their retention passes. */
    readonly enabled?: boolean
    /** How many days each backup is kept, 1 to 365. */
    readonly retentionDays?: number
  }
  /** How the site converts the images it receives (ADR-038): WebP at 85, 2400 pixels wide. */
  readonly media?: {
    readonly format?: 'webp' | 'avif' | 'original'
    readonly quality?: number
    readonly maxWidth?: number
    /** The narrower copies made of each image for `srcset`, in pixels: 640 and 1280 by default. */
    readonly widths?: readonly number[]
    /** Whether the file as it was uploaded is kept besides the one served: true by default. */
    readonly keepOriginals?: boolean
  }
}

/** What `hollware.config.ts` exports. */
export interface HollwareConfig {
  /**
   * The sites of 0.x, by key: since ADR-033 the sites live in D1, and these move there on the
   * first request of a deployment whose D1 has no definition for them. The key is the site's id
   * in the database, so it never changes once content exists.
   */
  readonly sites?: Readonly<Record<string, SiteDefinition>>
  /** How MCP clients and the admin get tokens (ADR-026). */
  readonly auth?: AuthDefinition
}

/** The OAuth server of a deployment. */
export interface AuthDefinition {
  /**
   * Whether a client may register itself (RFC 7591), for MCP clients that cannot present a
   * Client ID Metadata Document. Off by default: a registration is a write to KV that anyone can
   * make, and MCP 2026-07-28 prefers metadata documents.
   */
  readonly dynamicClientRegistration?: boolean
}

/** A collection once the config is resolved: checked, with every default filled in. */
export interface ResolvedCollection {
  readonly name: string
  readonly schema: DescribedSchema
  readonly routes: Readonly<Record<string, string>>
  readonly translationGroupField: string | null
  readonly tagsField: string | null
  readonly sortByField: string | null
  readonly components: ReadonlyMap<string, ComponentDefinition>
  /** The contracts of the collection; the built-in ones run besides them. */
  readonly contracts: readonly Contract<unknown>[]
  readonly maxMarkdownBytes: number
  readonly styleGuide: string | null
}

/** A site once the config is resolved. */
export interface ResolvedSite {
  readonly key: string
  readonly locales: readonly string[]
  readonly defaultLocale: string
  readonly styleGuide: string | null
  readonly collections: ReadonlyMap<string, ResolvedCollection>
  /** The public origin of the site, or `null`. */
  readonly url: string | null
  /** The origins that may call the read API from a page, each as `URL.origin` gives it. */
  readonly cors: { readonly origins: readonly string[] }
  readonly events: ResolvedEvents
  readonly audit: ResolvedAudit
  readonly backups: ResolvedBackups
  readonly media: ResolvedMedia
}

/** The daily backups of a site: whether the cron makes them, and how long each is kept. */
export interface ResolvedBackups {
  readonly enabled: boolean
  readonly retentionDays: number
}

/** How a site converts the images it receives (ADR-038). */
export interface ResolvedMedia {
  /** `original` keeps every file as it came; the others convert JPEG, PNG and GIF. */
  readonly format: 'webp' | 'avif' | 'original'
  /** The quality of photographs, 1 to 100; PNG is converted lossless whatever it says. */
  readonly quality: number
  /** The widest an image is kept, in pixels; a wider one is scaled down, never up. */
  readonly maxWidth: number
  /**
   * The widths of the narrower copies of each image, smallest first, for `srcset`: an image gets
   * those narrower than itself, made when it is uploaded. Empty makes none.
   */
  readonly widths: readonly number[]
  /**
   * Whether the file as it was uploaded is kept in R2 besides the one served, never served itself:
   * what a later change of format starts from. `false` keeps only what is served, and the copies.
   */
  readonly keepOriginals: boolean
}

/** What the activity log of a site keeps (ADR-037). */
export interface ResolvedAudit {
  readonly ipAddresses: 'off' | 'hashed'
  readonly retentionDays: number | null
}

/**
 * A webhook of a site. `secret` names the Worker secret that signs its deliveries; `null` when the
 * secret is Hollware's own, made by `make_webhook_secret` and sealed in the database (ADR-033).
 */
export interface ResolvedWebhook {
  readonly name: string
  readonly url: string
  readonly secret: string | null
}

/** Who hears about the publications of a site. */
export interface ResolvedEvents {
  readonly webhooks: readonly ResolvedWebhook[]
  readonly indexNow: { readonly key: string } | null
}

/** The config once resolved, at the start of the Worker: one site or more (ADR-027). */
export interface ResolvedConfig {
  readonly sites: ReadonlyMap<string, ResolvedSite>
  readonly auth: ResolvedAuth
}

/** The OAuth server once the config is resolved. */
export interface ResolvedAuth {
  readonly dynamicClientRegistration: boolean
}

/**
 * Checks a config and fills in its defaults. It throws one error that lists every problem, each
 * with its fix, so that a broken config stops the Worker at startup with an actionable message.
 */
export type ResolveConfig = (config: HollwareConfig) => ResolvedConfig
