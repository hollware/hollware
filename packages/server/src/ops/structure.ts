import {
  canonicalJson,
  compileSites,
  ConfigError,
  describeCatalog,
  siteDefinitionData,
  type SiteDefinitionData,
} from '@hollware/core'
import type { Structure, StructureActor } from '../ports.ts'
import { actorOf } from './actor.ts'
import { internalError } from './errors.ts'
import { siteEventFor } from './event.ts'
import type { OperationContext, OperationHandler } from './types.ts'

/**
 * The operations that change the structure of the sites (ADR-033): read it, replace the
 * definition of the site of the call or one of its collections, and make, trash and restore
 * sites. A change is checked whole before anything is written, and one that would leave entries
 * out of reach, or that its schema refuses, asks to be confirmed first. Entries are never deleted.
 */

/** How many entries of a collection a new schema is tried on, to tell what it refuses. */
export const IMPACT_SAMPLE = 500

/** How many slugs of refused entries an answer names. */
const EXAMPLES = 3

function structureOf(context: OperationContext): Structure {
  if (context.structure === undefined) {
    throw internalError(
      context,
      'An operation on the structure ran where the structure is not reachable.',
    )
  }
  return context.structure
}

function actor(context: OperationContext): StructureActor {
  const { userId, meta } = actorOf(context)
  return { userId, meta }
}

type Problems = { path: string; message: string; fix: string }[]

/** The problems of a definition for `key`, or none: it compiles as the registry will compile it. */
function problemsOf(key: string, definition: SiteDefinitionData): Problems {
  try {
    compileSites({ [key]: definition })
    return []
  } catch (error) {
    if (error instanceof ConfigError) return error.problems.map((problem) => ({ ...problem }))
    throw error
  }
}

async function impactOf(
  context: OperationContext,
  store: Structure['store'],
  current: SiteDefinitionData,
  next: SiteDefinitionData,
) {
  const site = context.site.key
  const counts = await store.counts(site)
  const removedCollections = Object.keys(current.collections)
    .filter((name) => next.collections[name] === undefined)
    .map((name) => ({ name, entries: counts.byCollection.get(name) ?? 0 }))
    .filter((removed) => removed.entries > 0)
  const removedLocales = current.locales
    .filter((locale) => !next.locales.includes(locale))
    .map((locale) => ({ locale, entries: counts.byLocale.get(locale) ?? 0 }))
    .filter((removed) => removed.entries > 0)
  const compiled = compileSites({ [site]: next }).sites.get(site)
  const refused: { collection: string; entries: number; examples: string[] }[] = []
  for (const [name, collection] of Object.entries(next.collections)) {
    const before = current.collections[name]
    if (before === undefined || canonicalJson(before.schema) === canonicalJson(collection.schema))
      continue
    const schema = compiled?.collections.get(name)?.schema
    if (schema === undefined) continue
    const slugs: string[] = []
    for (const entry of await store.frontmatters(site, name, IMPACT_SAMPLE)) {
      const result = await schema['~standard'].validate(entry.frontmatter)
      if (result.issues !== undefined) slugs.push(entry.slug)
    }
    if (slugs.length > 0)
      refused.push({ collection: name, entries: slugs.length, examples: slugs.slice(0, EXAMPLES) })
  }
  return { removedCollections, removedLocales, refused }
}

/** The definition of the site of the call, as stored, with its version. */
async function currentOf(context: OperationContext) {
  const stored = await structureOf(context).store.read(context.site.key)
  if (stored === null) {
    throw internalError(
      context,
      `The site ${context.site.key} is served and has no definition in D1.`,
    )
  }
  return { version: stored.version, definition: siteDefinitionData.parse(stored.definition) }
}

/**
 * A change sent at a version that is not the current one. It says which version is, and that the
 * change was not applied: whoever changed the structure since (often the caller's own earlier
 * update_site) made the definition that was read stale.
 */
function conflict(sent: number, current: number) {
  return {
    outcome: 'conflict' as const,
    currentVersion: current,
    message: `The structure is at version ${current}, not ${sent}: it changed since you read it, so nothing was applied.`,
    fix: `Call get_structure again, apply your change to the definition it returns (version ${current}), and send it with version ${current}. An earlier update_site or set_collection of yours also moves the version.`,
  }
}

/** Replaces the definition of the site of the call with `next`, as update_site answers. */
async function change(
  context: OperationContext,
  version: number,
  next: SiteDefinitionData,
  confirm: boolean,
) {
  const structure = structureOf(context)
  const problems = problemsOf(context.site.key, next)
  if (problems.length > 0) return { outcome: 'invalid' as const, problems }
  const current = await currentOf(context)
  if (current.version !== version) return conflict(version, current.version)
  if (canonicalJson(current.definition) === canonicalJson(next)) {
    return { outcome: 'unchanged' as const, version }
  }
  const impact = await impactOf(context, structure.store, current.definition, next)
  const touches =
    impact.removedCollections.length + impact.removedLocales.length + impact.refused.length
  if (touches > 0 && !confirm) return { outcome: 'needs_confirmation' as const, impact }
  // The sites that cache pages purge what the structure shows (ADR-033): the site, and the lists of
  // every collection and locale it had or has.
  const event = siteEventFor({
    site: context.site.key,
    at: context.clock.now().toISOString(),
    collections: [
      ...new Set([
        ...Object.keys(current.definition.collections),
        ...Object.keys(next.collections),
      ]),
    ],
    locales: [...new Set([...current.definition.locales, ...next.locales])],
  })
  const written = await structure.store.write({
    site: context.site.key,
    expected: version,
    definition: next,
    actor: actor(context),
    event,
  })
  if (written === 'conflict') {
    return conflict(version, (await currentOf(context)).version)
  }
  context.notify?.([event.id])
  await structure.changed()
  return { outcome: 'updated' as const, version: version + 1 }
}

/**
 * The URL of a webhook as a person who cannot change the structure sees it: its origin only. A
 * webhook's path and query often are its secret (a deploy hook), and `get_structure` asks only
 * for content:read, which authors have (T-70 of docs/security/threat-model.md).
 */
function originOnly(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

export const getStructure: OperationHandler<'get_structure'> = async (_input, context) => {
  const current = await currentOf(context)
  const scopes: readonly string[] = context.principal.scopes
  const owner = scopes.includes('schema:admin')
  const definition = owner
    ? current.definition
    : {
        ...current.definition,
        events: {
          ...current.definition.events,
          webhooks: current.definition.events.webhooks.map((webhook) => ({
            ...webhook,
            url: originOnly(webhook.url),
          })),
        },
      }
  return {
    outcome: 'ok',
    site: context.site.key,
    version: current.version,
    definition,
    catalog: describeCatalog(),
  }
}

export const updateSite: OperationHandler<'update_site'> = (input, context) =>
  change(context, input.version, input.definition, input.confirm)

export const setCollection: OperationHandler<'set_collection'> = async (input, context) => {
  const current = await currentOf(context)
  const collections = { ...current.definition.collections }
  if (input.collection === null) delete collections[input.name]
  else collections[input.name] = input.collection
  return change(context, input.version, { ...current.definition, collections }, input.confirm)
}

export const createSite: OperationHandler<'create_site'> = async (input, context) => {
  const structure = structureOf(context)
  const problems = problemsOf(input.key, input.definition)
  if (problems.length > 0) return { outcome: 'invalid', problems }
  const made = await structure.store.create({
    site: input.key,
    definition: input.definition,
    actor: actor(context),
  })
  if (made === 'taken') return { outcome: 'taken' }
  await structure.changed()
  return { outcome: 'created', version: 1 }
}

/** Whether the person of the call owns `site`; a site they do not own is one they cannot see. */
async function owns(context: OperationContext, site: string): Promise<boolean> {
  return (await structureOf(context).store.roleOf(site, actor(context).userId)) === 'owner'
}

export const deleteSite: OperationHandler<'delete_site'> = async (input, context) => {
  const structure = structureOf(context)
  const stored = await structure.store.read(input.key)
  if (stored === null || stored.deletedAt !== null || !(await owns(context, input.key))) {
    return { outcome: 'not_found' }
  }
  if (!input.confirm) {
    const { byCollection } = await structure.store.counts(input.key)
    const entries = [...byCollection.values()].reduce((sum, count) => sum + count, 0)
    return { outcome: 'needs_confirmation', entries }
  }
  if (!(await structure.store.trash(input.key, actor(context)))) return { outcome: 'not_found' }
  await structure.changed()
  return { outcome: 'trashed' }
}

export const restoreSite: OperationHandler<'restore_site'> = async (input, context) => {
  const structure = structureOf(context)
  const stored = await structure.store.read(input.key)
  if (stored === null || stored.deletedAt === null || !(await owns(context, input.key))) {
    return { outcome: 'not_found' }
  }
  if (!(await structure.store.restore(input.key, actor(context)))) return { outcome: 'not_found' }
  await structure.changed()
  return { outcome: 'restored' }
}

export const makeWebhookSecret: OperationHandler<'make_webhook_secret'> = async (
  input,
  context,
) => {
  const structure = structureOf(context)
  const { definition } = await currentOf(context)
  const webhook = definition.events.webhooks.find((candidate) => candidate.name === input.webhook)
  // A webhook signed by a Worker secret of its own has nothing for Hollware to make.
  if (webhook === undefined || webhook.secret !== undefined) return { outcome: 'not_found' }
  const secret =
    (await structure.secrets?.make(context.site.key, `webhook:${webhook.name}`)) ?? null
  return secret === null ? { outcome: 'unavailable' } : { outcome: 'made', secret }
}
