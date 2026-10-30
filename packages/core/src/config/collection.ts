import { readAutomaticFields } from './automatic.ts'
import { readNavigation } from './navigation.ts'
import { BUILT_IN_CONTRACT_IDS, isBuiltInContract } from '../contracts/index.ts'
import type { Contract, Phase, Severity } from '../contracts/types.ts'
import type { Problems } from './config-error.ts'
import {
  CONTRACT_ID,
  DEFAULT_MAX_MARKDOWN_BYTES,
  MAX_MARKDOWN_BYTES_CEILING,
  NAME,
  nameFix,
  RESERVED_COLLECTION_NAMES,
} from './constants.ts'
import {
  describeShape,
  isDateSchema,
  isStringArraySchema,
  isStringSchema,
  resolveSchema,
  toJsonSchema,
} from './json-schema.ts'
import type { ComponentDefinition, DescribedSchema, ResolvedCollection } from './types.ts'
import {
  isRecord,
  itemPath,
  type JsonObject,
  keyPath,
  oneLine,
  quote,
  readOptionalString,
  wrongType,
} from './values.ts'

export interface SiteContext {
  readonly path: string
  readonly locales: readonly string[]
  readonly localesOk: boolean
  readonly routes: Map<string, string>
}

const RESERVED: ReadonlySet<string> = new Set(BUILT_IN_CONTRACT_IDS)

const SCHEMA_FIX =
  'Use a schema from a library that implements Standard Schema and Standard JSON Schema, such as zod 4.2 or later.'

interface ObjectSchema {
  readonly schema: DescribedSchema
  readonly document: JsonObject
  readonly object: JsonObject
}

function standardProps(value: unknown): unknown {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? Reflect.get(value, '~standard')
    : undefined
}

function isDescribedSchema(value: unknown): value is DescribedSchema {
  const standard = standardProps(value)
  if (!isRecord(standard) || typeof standard['validate'] !== 'function') return false
  const converter = standard['jsonSchema']
  return isRecord(converter) && typeof converter['input'] === 'function'
}

function whyNotDescribed(value: unknown): string {
  const standard = standardProps(value)
  if (!isRecord(standard)) return wrongType(value, 'a Standard Schema with JSON Schema')
  if (typeof standard['validate'] !== 'function') {
    return 'has no ~standard.validate function, so it is no Standard Schema'
  }
  return 'has no ~standard.jsonSchema.input function, so describe_site could not show it to agents'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readSchema(
  path: string,
  raw: unknown,
  kind: 'frontmatter' | 'props',
  problems: Problems,
): ObjectSchema | null {
  if (!isDescribedSchema(raw)) {
    problems.add(path, whyNotDescribed(raw), SCHEMA_FIX)
    return null
  }
  let document: JsonObject
  try {
    document = toJsonSchema(raw)
  } catch (error) {
    problems.add(
      path,
      `cannot be converted to JSON Schema (${oneLine(errorMessage(error))})`,
      'Remove what JSON Schema cannot express, such as z.date() (use z.iso.date() for dates), z.custom() or z.map(), so that agents can read the schema.',
    )
    return null
  }
  const object = resolveSchema(document, document)
  if (object?.['type'] !== 'object') {
    problems.add(
      path,
      `describes ${describeShape(document, document)} instead of an object`,
      kind === 'props'
        ? 'Declare the props as an object, such as z.strictObject({ type: z.enum(["info", "tip"]) }).'
        : 'Declare the frontmatter as an object, such as z.object({ title: z.string() }).',
    )
    return null
  }
  if (kind === 'props' && object['additionalProperties'] !== false) {
    problems.add(
      path,
      'accepts props it does not declare, because its JSON Schema does not set additionalProperties to false',
      'Declare the props with z.strictObject({ … }) instead of z.object({ … }), or with the strict object of your validation library, so that a prop the component does not declare is an error.',
    )
    return null
  }
  return { schema: raw, document, object }
}

const ROUTES_FIX =
  'Add one route per locale, such as routes: { es: "/blog/:slug/", en: "/en/blog/:slug/" }.'

const SLUG_PLACEHOLDER = /:slug(?![A-Za-z0-9_])/g

function isRoutePattern(path: string, route: string, problems: Problems): boolean {
  let valid = true
  if (!route.startsWith('/')) {
    problems.add(
      path,
      `${quote(route)} does not start with "/"`,
      'Write the path from the root of the site, such as "/blog/:slug/".',
    )
    valid = false
  }
  const slugs = [...route.matchAll(SLUG_PLACEHOLDER)].length
  if (slugs !== 1) {
    problems.add(
      path,
      slugs === 0 ? `${quote(route)} has no :slug` : `${quote(route)} has :slug ${slugs} times`,
      'Use :slug exactly once, where the slug of the entry goes, such as "/blog/:slug/".',
    )
    valid = false
  }
  return valid
}

function claimRoute(route: string, path: string, site: SiteContext, problems: Problems): void {
  const pattern = route.endsWith('/') ? route.slice(0, -1) : route
  const owner = site.routes.get(pattern)
  if (owner === undefined) {
    site.routes.set(pattern, path)
    return
  }
  problems.add(
    path,
    `${quote(route)} is the same pattern as the route at ${owner}`,
    'Give every route of the site its own path: internal links are matched against them.',
  )
}

function readRoutes(
  path: string,
  raw: unknown,
  collection: string,
  site: SiteContext,
  problems: Problems,
): Record<string, string> {
  if (!isRecord(raw)) {
    problems.add(path, wrongType(raw, 'an object with one path per locale'), ROUTES_FIX)
    return {}
  }
  for (const locale of Object.keys(raw)) {
    const routePath = keyPath(path, locale)
    const route = raw[locale]
    const known = !site.localesOk || site.locales.includes(locale)
    if (!known) {
      problems.add(
        routePath,
        `is a route for ${quote(locale)}, which is not a locale of the site (${site.locales.join(', ')})`,
        `Remove it, or add ${quote(locale)} to the locales of the site.`,
      )
    }
    if (typeof route !== 'string') {
      problems.add(routePath, wrongType(route, 'a path such as "/blog/:slug/"'), ROUTES_FIX)
    } else if (isRoutePattern(routePath, route, problems) && known) {
      claimRoute(route, routePath, site, problems)
    }
  }
  if (site.localesOk) {
    for (const locale of site.locales) {
      if (!Object.hasOwn(raw, locale)) {
        problems.add(
          path,
          `has no route for the locale ${quote(locale)}`,
          `Add ${keyPath('routes', locale)}, a path such as ${quote(`/${locale}/${collection}/:slug/`)}.`,
        )
      }
    }
  }
  const routes: Record<string, string> = {}
  for (const locale of site.locales) {
    const route = raw[locale]
    if (typeof route === 'string') routes[locale] = route
  }
  return routes
}

interface FieldKind {
  readonly mustBe: string
  readonly accepts: (document: JsonObject, property: unknown) => boolean
  readonly fix: (field: string) => string
}

const GROUP_BY: FieldKind = {
  mustBe: 'a string',
  accepts: isStringSchema,
  fix: (field) => `Declare ${quote(field)} as z.string() in the schema, or name another field.`,
}

const TAGS: FieldKind = {
  mustBe: 'an array of strings',
  accepts: isStringArraySchema,
  fix: (field) =>
    `Declare ${quote(field)} as z.array(z.string()) in the schema, or name another field.`,
}

const SORT_BY: FieldKind = {
  mustBe: 'a string with the "date" or "date-time" format',
  accepts: isDateSchema,
  fix: (field) =>
    `Declare ${quote(field)} as z.iso.date() or z.iso.datetime() in the schema, or name another field.`,
}

function readField(
  path: string,
  raw: unknown,
  schema: ObjectSchema | null,
  kind: FieldKind,
  problems: Problems,
): string | null {
  if (typeof raw !== 'string' || raw === '') {
    problems.add(
      path,
      wrongType(raw, 'the name of a frontmatter field'),
      'Set it to the name of a field of the frontmatter schema, or remove it.',
    )
    return null
  }
  if (schema === null) return raw
  const properties = isRecord(schema.object['properties']) ? schema.object['properties'] : {}
  if (!Object.hasOwn(properties, raw)) {
    const names = Object.keys(properties)
    problems.add(
      path,
      `${quote(raw)} is not a property of the schema${names.length === 0 ? ', which declares none' : ` (its properties are ${names.map(quote).join(', ')})`}`,
      `Name a field that the schema declares, or add ${quote(raw)} to the schema.`,
    )
  } else if (!kind.accepts(schema.document, properties[raw])) {
    problems.add(
      path,
      `${quote(raw)} is declared as ${describeShape(schema.document, properties[raw])}, but it must be ${kind.mustBe}`,
      kind.fix(raw),
    )
  }
  return raw
}

function readTranslations(
  path: string,
  raw: unknown,
  schema: ObjectSchema | null,
  problems: Problems,
): string | null {
  if (raw === undefined) return null
  if (!isRecord(raw)) {
    problems.add(
      path,
      wrongType(raw, 'an object like { groupBy: "translationGroup" }'),
      'Set it to { groupBy: "<field>" }, the field of the frontmatter that holds the key the translations of an entry share, or remove it.',
    )
    return null
  }
  return readField(keyPath(path, 'groupBy'), raw['groupBy'], schema, GROUP_BY, problems)
}

const COMPONENT_FIX = 'Declare it with defineComponent({ props: z.strictObject({ … }) }).'

function readComponent(
  path: string,
  name: string,
  raw: unknown,
  problems: Problems,
): ComponentDefinition | null {
  if (!NAME.test(name)) {
    problems.add(path, `${quote(name)} is not a valid component name`, nameFix('callout'))
  }
  if (!isRecord(raw)) {
    problems.add(path, wrongType(raw, 'a component'), COMPONENT_FIX)
    return null
  }
  const props = readSchema(keyPath(path, 'props'), raw['props'], 'props', problems)
  const textFix = 'Write it as a string, or remove it.'
  const description = readOptionalString(
    keyPath(path, 'description'),
    raw['description'],
    textFix,
    problems,
  )
  const example = readOptionalString(keyPath(path, 'example'), raw['example'], textFix, problems)
  if (props === null) return null
  return {
    props: props.schema,
    ...(description === null ? {} : { description }),
    ...(example === null ? {} : { example }),
  }
}

function readComponents(
  path: string,
  raw: unknown,
  problems: Problems,
): Map<string, ComponentDefinition> {
  const components = new Map<string, ComponentDefinition>()
  if (raw === undefined) return components
  if (!isRecord(raw)) {
    problems.add(
      path,
      wrongType(raw, 'an object that maps each component name to its definition'),
      COMPONENT_FIX,
    )
    return components
  }
  for (const name of Object.keys(raw)) {
    const component = readComponent(keyPath(path, name), name, raw[name], problems)
    if (component !== null) components.set(name, component)
  }
  return components
}

function isSeverity(value: unknown): value is Severity {
  return value === 'error' || value === 'warning'
}

function isPhase(value: unknown): value is Phase {
  return value === 'write' || value === 'publish'
}

const PHASES_FIX =
  'Use "write" (create_draft and update_draft), "publish" (validate and publish) or both, or remove phases to run in both.'

function checkPhases(path: string, raw: unknown, problems: Problems): void {
  if (raw === undefined) return
  if (!Array.isArray(raw)) {
    problems.add(path, wrongType(raw, 'an array of "write" and "publish"'), PHASES_FIX)
    return
  }
  if (raw.length === 0) {
    problems.add(path, 'is empty, so the contract would never run', PHASES_FIX)
    return
  }
  const seen = new Set<unknown>()
  const phases: readonly unknown[] = raw
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index]
    if (!isPhase(phase)) {
      problems.add(itemPath(path, index), wrongType(phase, '"write" or "publish"'), PHASES_FIX)
    } else if (seen.has(phase)) {
      problems.add(itemPath(path, index), `repeats ${quote(phase)}`, PHASES_FIX)
    }
    seen.add(phase)
  }
}

function isContract(item: unknown, path: string, problems: Problems): item is Contract<unknown> {
  if (!isRecord(item)) {
    problems.add(
      path,
      wrongType(item, 'a contract'),
      'Write it as { id, severity, description, check }.',
    )
    return false
  }
  const before = problems.list.length
  const id = item['id']
  if (typeof id !== 'string' || !CONTRACT_ID.test(id)) {
    problems.add(
      keyPath(path, 'id'),
      wrongType(id, 'lowercase words joined by hyphens, such as "seo-title-length"'),
      'Name the rule with lowercase words joined by hyphens.',
    )
  }
  if (!isSeverity(item['severity'])) {
    problems.add(
      keyPath(path, 'severity'),
      wrongType(item['severity'], '"error" or "warning"'),
      'Use "error" for a rule that blocks publishing and "warning" for one that publishing asks to acknowledge.',
    )
  }
  checkPhases(keyPath(path, 'phases'), item['phases'], problems)
  const description = item['description']
  if (typeof description !== 'string' || description.trim() === '') {
    problems.add(
      keyPath(path, 'description'),
      wrongType(description, 'a sentence that says what the rule asks for'),
      'Describe the rule for the agent that has to follow it.',
    )
  }
  if (typeof item['check'] !== 'function') {
    problems.add(
      keyPath(path, 'check'),
      wrongType(item['check'], 'a function that returns the problems it finds'),
      'Add check(context), which returns a list of problems, empty when the content passes.',
    )
  }
  return problems.list.length === before
}

function checkIdentity(
  id: string,
  own: boolean,
  path: string,
  ids: Map<string, string>,
  problems: Problems,
): void {
  if (RESERVED.has(id) && !own) {
    problems.add(
      keyPath(path, 'id'),
      `${quote(id)} is the id of a built-in contract`,
      `Choose another id: ${BUILT_IN_CONTRACT_IDS.join(', ')} belong to Hollware's built-in contracts, and the opt-in ones are listed as contracts.translationPair(), contracts.internalLinksResolve() and contracts.imagesHaveAlt().`,
    )
    return
  }
  const first = ids.get(id)
  if (first === undefined) {
    ids.set(id, path)
    return
  }
  problems.add(
    keyPath(path, 'id'),
    `${quote(id)} is already the id of the contract at ${first}`,
    'Give every contract of the collection its own id.',
  )
}

function readContracts(path: string, raw: unknown, problems: Problems): Contract<unknown>[] {
  const contracts: Contract<unknown>[] = []
  if (raw === undefined) return contracts
  if (!Array.isArray(raw)) {
    problems.add(
      path,
      wrongType(raw, 'an array of contracts'),
      'Write it as [{ id, severity, description, check }, …].',
    )
    return contracts
  }
  const ids = new Map<string, string>()
  const items: readonly unknown[] = raw
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const itemAt = itemPath(path, index)
    if (isContract(item, itemAt, problems)) {
      checkIdentity(item.id, isBuiltInContract(item), itemAt, ids, problems)
      contracts.push(item)
    } else if (isRecord(item) && typeof item['id'] === 'string' && CONTRACT_ID.test(item['id'])) {
      checkIdentity(item['id'], false, itemAt, ids, problems)
    }
  }
  return contracts
}

function readMaxMarkdownBytes(path: string, raw: unknown, problems: Problems): number {
  if (raw === undefined) return DEFAULT_MAX_MARKDOWN_BYTES
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= 1 &&
    raw <= MAX_MARKDOWN_BYTES_CEILING
  ) {
    return raw
  }
  problems.add(
    path,
    wrongType(raw, `an integer from 1 to ${MAX_MARKDOWN_BYTES_CEILING}`),
    `Set a size in bytes from 1 to ${MAX_MARKDOWN_BYTES_CEILING} (768 KiB), or remove it for the default of ${DEFAULT_MAX_MARKDOWN_BYTES} (512 KiB): a revision row is about 2.3 times the file and the store refuses rows over 1.9 MB, so a larger file could never be saved.`,
  )
  return DEFAULT_MAX_MARKDOWN_BYTES
}

export function readCollection(
  path: string,
  name: string,
  raw: unknown,
  site: SiteContext,
  problems: Problems,
): ResolvedCollection | null {
  if (!NAME.test(name)) {
    problems.add(path, `${quote(name)} is not a valid collection name`, nameFix('blog'))
  } else if (RESERVED_COLLECTION_NAMES.includes(name)) {
    problems.add(
      path,
      `${quote(name)} is a route of the read API (/v1/${name}), so no collection may take it`,
      `Name the collection otherwise, such as "${name}-pages".`,
    )
  }
  if (!isRecord(raw)) {
    problems.add(
      path,
      wrongType(raw, 'a collection'),
      'Declare it with defineCollection({ schema, routes, … }).',
    )
    return null
  }
  const schema = readSchema(keyPath(path, 'schema'), raw['schema'], 'frontmatter', problems)
  const routes = readRoutes(keyPath(path, 'routes'), raw['routes'], name, site, problems)
  const translationGroupField = readTranslations(
    keyPath(path, 'translations'),
    raw['translations'],
    schema,
    problems,
  )
  const tagsField =
    raw['tags'] === undefined
      ? null
      : readField(keyPath(path, 'tags'), raw['tags'], schema, TAGS, problems)
  const sortByField =
    raw['sortBy'] === undefined
      ? null
      : readField(keyPath(path, 'sortBy'), raw['sortBy'], schema, SORT_BY, problems)
  const automaticFields = readAutomaticFields(
    keyPath(path, 'automatic'),
    raw['automatic'],
    schema,
    problems,
  )
  const components = readComponents(keyPath(path, 'components'), raw['components'], problems)
  const contracts = readContracts(keyPath(path, 'contracts'), raw['contracts'], problems)
  const maxMarkdownBytes = readMaxMarkdownBytes(
    keyPath(path, 'maxMarkdownBytes'),
    raw['maxMarkdownBytes'],
    problems,
  )
  const styleGuide = readOptionalString(
    keyPath(path, 'styleGuide'),
    raw['styleGuide'],
    'Write the guidance as a Markdown string, or remove it.',
    problems,
  )
  const navigation = readNavigation(
    keyPath(path, 'navigation'),
    raw['navigation'],
    schema,
    problems,
  )
  if (schema === null) return null
  return {
    name,
    schema: schema.schema,
    routes,
    translationGroupField,
    tagsField,
    sortByField,
    automaticFields,
    components,
    contracts,
    maxMarkdownBytes,
    styleGuide,
    navigation,
  }
}
