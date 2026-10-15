import type { Problems } from './config-error.ts'
import type { ResolvedEvents, ResolvedWebhook } from './types.ts'
import { isRecord, itemPath, keyPath, quote, wrongType } from './values.ts'

/** The name of a Worker secret or variable: what `wrangler secret put` takes. */
const BINDING_NAME = /^[A-Z][A-Z0-9_]*$/
/** A subscriber's name: lowercase words joined by hyphens. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The public URL of a site: an absolute http or https URL with no path, query or fragment. */
export function readSiteUrl(path: string, raw: unknown, problems: Problems): string | null {
  if (raw === undefined) return null
  const fix = 'Write the public origin of the site, such as "https://example.com".'
  if (typeof raw !== 'string' || !URL.canParse(raw)) {
    problems.add(path, wrongType(raw, 'an absolute URL'), fix)
    return null
  }
  const url = new URL(raw)
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    problems.add(path, `${quote(raw)} is not an origin`, fix)
    return null
  }
  return url.origin
}

/** The origins of a site's pages that may read its published content from the browser. */
export function readCors(
  path: string,
  raw: unknown,
  problems: Problems,
): { readonly origins: readonly string[] } {
  if (raw === undefined) return { origins: [] }
  if (!isRecord(raw) || !Array.isArray(raw['origins'])) {
    problems.add(
      path,
      wrongType(raw, 'an object with origins'),
      'Declare it as { origins: ["https://example.com"] }, or remove it.',
    )
    return { origins: [] }
  }
  const origins: string[] = []
  for (const [index, origin] of raw['origins'].entries()) {
    const read = readSiteUrl(itemPath(keyPath(path, 'origins'), index), origin, problems)
    if (read !== null && !origins.includes(read)) origins.push(read)
  }
  return { origins }
}

function readBindingName(path: string, raw: unknown, problems: Problems): string | null {
  if (typeof raw === 'string' && BINDING_NAME.test(raw)) return raw
  problems.add(
    path,
    wrongType(raw, 'the name of a Worker secret'),
    'Name the secret that holds the value, such as "WEBHOOK_SECRET", and set it with wrangler secret put.',
  )
  return null
}

function readWebhook(path: string, raw: unknown, problems: Problems): ResolvedWebhook | null {
  if (!isRecord(raw)) {
    problems.add(
      path,
      wrongType(raw, 'a webhook'),
      'Declare it as { name: "newsletter", url: "https://…", secret: "WEBHOOK_SECRET" }.',
    )
    return null
  }
  const name = raw['name']
  if (typeof name !== 'string' || !NAME.test(name)) {
    problems.add(
      keyPath(path, 'name'),
      wrongType(name, 'a name'),
      'Name it with lowercase words joined by hyphens, such as "newsletter".',
    )
  }
  const url = raw['url']
  const urlOk = typeof url === 'string' && URL.canParse(url) && new URL(url).protocol === 'https:'
  if (!urlOk) {
    problems.add(
      keyPath(path, 'url'),
      wrongType(url, 'an https URL'),
      'Give the https URL that receives the events.',
    )
  }
  const secret = readBindingName(keyPath(path, 'secret'), raw['secret'], problems)
  if (typeof name !== 'string' || !NAME.test(name) || !urlOk || secret === null) return null
  return { name, url: String(url), secret }
}

/** Who hears about publications (ADR-025): webhooks, and IndexNow when the site has a URL. */
export function readEvents(
  path: string,
  raw: unknown,
  siteUrl: string | null,
  problems: Problems,
): ResolvedEvents {
  const events: { webhooks: ResolvedWebhook[]; indexNow: { key: string } | null } = {
    webhooks: [],
    indexNow: null,
  }
  if (raw === undefined) return events
  if (!isRecord(raw)) {
    problems.add(path, wrongType(raw, 'an object'), 'Declare { webhooks: [ … ], indexNow: { … } }.')
    return events
  }
  const webhooks = raw['webhooks']
  if (webhooks !== undefined) {
    if (!Array.isArray(webhooks)) {
      problems.add(keyPath(path, 'webhooks'), wrongType(webhooks, 'a list'), 'List the webhooks.')
    } else {
      const seen = new Set<string>()
      webhooks.forEach((item: unknown, index) => {
        const webhook = readWebhook(itemPath(keyPath(path, 'webhooks'), index), item, problems)
        if (webhook === null) return
        if (seen.has(webhook.name)) {
          problems.add(
            itemPath(keyPath(path, 'webhooks'), index),
            `repeats the name ${quote(webhook.name)}`,
            'Give each webhook a name of its own.',
          )
          return
        }
        seen.add(webhook.name)
        events.webhooks.push(webhook)
      })
    }
  }
  const indexNow = raw['indexNow']
  if (indexNow !== undefined) {
    const indexPath = keyPath(path, 'indexNow')
    if (!isRecord(indexNow)) {
      problems.add(indexPath, wrongType(indexNow, 'an object'), 'Declare { key: "INDEXNOW_KEY" }.')
    } else {
      const key = readBindingName(keyPath(indexPath, 'key'), indexNow['key'], problems)
      if (siteUrl === null) {
        problems.add(
          indexPath,
          'needs the URL of the site',
          'Set url on the site: IndexNow is told the public URLs of the entries.',
        )
      } else if (key !== null) {
        events.indexNow = { key }
      }
    }
  }
  return events
}
