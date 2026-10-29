import { readCollection, type SiteContext } from './collection.ts'
import { ConfigError, Problems } from './config-error.ts'
import { readAudit } from './audit.ts'
import { readBackups } from './backups.ts'
import { readMedia } from './media.ts'
import { readAccess } from './access.ts'
import { readAuth } from './auth.ts'
import { readCors, readEvents, readSiteUrl } from './events.ts'
import { LOCALE_TAG } from './constants.ts'
import { isSiteKey, SITE_KEY_MAX_LENGTH } from './site-key.ts'
import type {
  ResolvedAdmin,
  ResolvedAuth,
  ResolvedCollection,
  ResolvedConfig,
  ResolvedSite,
} from './types.ts'
import { isRecord, itemPath, keyPath, quote, readOptionalString, wrongType } from './values.ts'

const SITE_FIX =
  'Declare one site: sites: { "my-site": { locales: ["en"], defaultLocale: "en", collections: { … } } }.'

const SITE_KEY_FIX = `Use lowercase letters and digits joined by single hyphens, from 1 to ${SITE_KEY_MAX_LENGTH} characters, such as "my-site".`

const LOCALE_FIX =
  'Write a language, then a region if you need one: "es", "en" or "pt-BR" (lowercase language, uppercase region).'

function readLocales(
  path: string,
  raw: unknown,
  problems: Problems,
): { locales: string[]; ok: boolean } {
  if (!Array.isArray(raw)) {
    problems.add(
      path,
      wrongType(raw, 'an array of language tags'),
      'List the languages of the site, such as ["es", "en"].',
    )
    return { locales: [], ok: false }
  }
  if (raw.length === 0) {
    problems.add(path, 'is empty', 'List at least one language tag, such as ["en"].')
    return { locales: [], ok: false }
  }
  const locales: string[] = []
  const firstAt = new Map<string, number>()
  const tags: readonly unknown[] = raw
  let ok = true
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    const tagPath = itemPath(path, index)
    if (typeof tag !== 'string') {
      problems.add(tagPath, wrongType(tag, 'a language tag'), LOCALE_FIX)
      ok = false
      continue
    }
    locales.push(tag)
    if (!LOCALE_TAG.test(tag)) {
      problems.add(tagPath, `${quote(tag)} is not a language tag`, LOCALE_FIX)
      ok = false
      continue
    }
    const first = firstAt.get(tag)
    if (first === undefined) {
      firstAt.set(tag, index)
    } else {
      problems.add(
        tagPath,
        `${quote(tag)} is already listed at ${itemPath(path, first)}`,
        'List each locale once.',
      )
      ok = false
    }
  }
  return { locales, ok }
}

function readDefaultLocale(
  path: string,
  raw: unknown,
  locales: readonly string[],
  problems: Problems,
): string {
  if (typeof raw !== 'string') {
    problems.add(
      path,
      wrongType(raw, 'one of the locales'),
      'Set it to the main language of the site, one of its locales.',
    )
    return ''
  }
  if (locales.length > 0 && !locales.includes(raw)) {
    problems.add(
      path,
      `is ${quote(raw)}, which is not one of the locales (${locales.map(quote).join(', ')})`,
      `Set it to one of ${locales.map(quote).join(', ')}, or add ${quote(raw)} to locales.`,
    )
  }
  return raw
}

const COLLECTIONS_FIX =
  'Declare at least one: collections: { blog: defineCollection({ schema, routes }) }.'

function readCollections(
  path: string,
  raw: unknown,
  site: SiteContext,
  problems: Problems,
): Map<string, ResolvedCollection> {
  const collections = new Map<string, ResolvedCollection>()
  if (!isRecord(raw)) {
    problems.add(
      path,
      wrongType(raw, 'an object that maps each collection name to its collection'),
      COLLECTIONS_FIX,
    )
    return collections
  }
  const names = Object.keys(raw)
  if (names.length === 0) problems.add(path, 'has no collection', COLLECTIONS_FIX)
  for (const name of names) {
    const collection = readCollection(keyPath(path, name), name, raw[name], site, problems)
    if (collection !== null) collections.set(name, collection)
  }
  return collections
}

function readSite(key: string, raw: unknown, problems: Problems): ResolvedSite | null {
  const path = keyPath('sites', key)
  if (!isSiteKey(key)) {
    problems.add(path, `${quote(key)} is not a valid site key`, SITE_KEY_FIX)
  }
  if (!isRecord(raw)) {
    problems.add(
      path,
      wrongType(raw, 'a site'),
      'Declare it as { locales: ["en"], defaultLocale: "en", collections: { … } }.',
    )
    return null
  }
  const { locales, ok } = readLocales(keyPath(path, 'locales'), raw['locales'], problems)
  const defaultLocale = readDefaultLocale(
    keyPath(path, 'defaultLocale'),
    raw['defaultLocale'],
    locales,
    problems,
  )
  const collections = readCollections(
    keyPath(path, 'collections'),
    raw['collections'],
    { path, locales, localesOk: ok, routes: new Map() },
    problems,
  )
  const styleGuide = readOptionalString(
    keyPath(path, 'styleGuide'),
    raw['styleGuide'],
    'Write the guidance as a Markdown string, or remove it.',
    problems,
  )
  const url = readSiteUrl(keyPath(path, 'url'), raw['url'], problems)
  const cors = readCors(keyPath(path, 'cors'), raw['cors'], problems)
  const events = readEvents(keyPath(path, 'events'), raw['events'], url, problems)
  const audit = readAudit(keyPath(path, 'audit'), raw['audit'], problems)
  const backups = readBackups(keyPath(path, 'backups'), raw['backups'], problems)
  const media = readMedia(keyPath(path, 'media'), raw['media'], problems)
  const access = readAccess(keyPath(path, 'access'), raw['access'], problems)
  return {
    key,
    locales,
    defaultLocale,
    styleGuide,
    collections,
    url,
    cors,
    events,
    audit,
    backups,
    media,
    access,
  }
}

function readSites(raw: unknown, problems: Problems): Map<string, ResolvedSite> {
  const sites = new Map<string, ResolvedSite>()
  if (!isRecord(raw)) {
    problems.add('sites', wrongType(raw, 'an object that maps the site key to the site'), SITE_FIX)
    return sites
  }
  const keys = Object.keys(raw)
  if (keys.length === 0) {
    problems.add('sites', 'has no site, and a deployment serves at least one', SITE_FIX)
  }
  for (const key of keys) {
    const site = readSite(key, raw[key], problems)
    if (site !== null) sites.set(key, site)
  }
  return sites
}

const FAVICON_FIX = "Write admin: { favicon: 'https://example.com/icon.png' }, or leave it out."

function readAdmin(raw: unknown, problems: Problems): ResolvedAdmin {
  if (raw === undefined) return { favicon: null }
  if (!isRecord(raw)) {
    problems.add('admin', wrongType(raw, 'an object'), FAVICON_FIX)
    return { favicon: null }
  }
  const favicon = raw['favicon']
  if (favicon === undefined) return { favicon: null }
  if (typeof favicon !== 'string' || URL.parse(favicon)?.protocol !== 'https:') {
    problems.add('admin.favicon', wrongType(favicon, 'an https:// URL'), FAVICON_FIX)
    return { favicon: null }
  }
  return { favicon }
}

/**
 * Checks `admin` of the config on its own, for a deployment whose sites already live in D1, and
 * throws a `ConfigError` that says what to change.
 */
export function resolveAdmin(admin: unknown): ResolvedAdmin {
  const problems = new Problems()
  const resolved = readAdmin(admin, problems)
  if (problems.list.length > 0) throw new ConfigError(problems.list)
  return resolved
}

/**
 * Checks the config of the deployment and fills in its defaults, or throws a `ConfigError` with
 * every problem it found, so that a broken `hollware.config.ts` stops the Worker at startup with
 * a message that says what to change. A deployment serves one site or more.
 *
 * The parameter is `unknown` because the config comes from user code that may be plain
 * JavaScript; a `HollwareConfig` is accepted as is, so this is a `ResolveConfig`. Notes on the
 * rules:
 *
 * - A site key is lowercase letters and digits joined by single hyphens, from 1 to 64 characters
 *   (`isSiteKey`, the rule of the CLI). A collection name and a component name are lowercase
 *   letters, digits and hyphens, starting with a letter, at most 63 characters. A contract id is
 *   lowercase words joined by single hyphens, and the id of a built-in contract
 *   (`BUILT_IN_CONTRACT_IDS`) is taken only by a contract that Hollware made (`isBuiltInContract`:
 *   `contracts.translationPair()` and the like), once.
 * - Each locale is a language tag with an optional script and region (`es`, `pt-BR`,
 *   `zh-Hant-TW`). Routes are checked against the locales only when the locales are valid.
 * - A route has `:slug` once. Two routes of the site are the same pattern when they differ at
 *   most by a trailing slash; patterns that overlap without being equal are not detected.
 * - `translations.groupBy`, `tags` and `sortBy` name properties of the frontmatter's JSON Schema
 *   (as agents see it, so `$ref`s are followed). `groupBy` is a string, `tags` an array of
 *   strings and `sortBy` a string with the `date` or `date-time` format: a plain string does not
 *   prove that the listing sorts by time. None may be nullable, and each may be optional.
 * - Collections, components and contracts keep the order of the config; each collection's routes
 *   come out in the order of the site's locales.
 */
export function resolveConfig(config: unknown): ResolvedConfig {
  const problems = new Problems()
  let sites = new Map<string, ResolvedSite>()
  let auth: ResolvedAuth = { dynamicClientRegistration: false, passkeys: true, providers: [] }
  let admin: ResolvedAdmin = { favicon: null }
  if (isRecord(config)) {
    sites = readSites(config['sites'], problems)
    auth = readAuth(config['auth'], problems)
    admin = readAdmin(config['admin'], problems)
  } else {
    problems.add(
      'config',
      wrongType(config, 'an object'),
      'Export the result of defineConfig({ sites: { … } }) from hollware.config.ts.',
    )
  }
  if (problems.list.length > 0) throw new ConfigError(problems.list)
  return { sites, auth, admin }
}
