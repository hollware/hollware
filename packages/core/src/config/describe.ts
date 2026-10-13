import type * as z from 'zod'
import { type ContractDescription, describeContract } from '../contracts/index.ts'
import type { siteDescription } from '../operations/schemas.ts'
import { toJsonSchema } from './json-schema.ts'
import type { ResolvedCollection, ResolvedSite } from './types.ts'

/** A site as `describe_site` shows it to agents: the `site` of the operation's output. */
export type SiteDescription = z.output<typeof siteDescription>

/** What a call without built-in contracts memoizes under. */
const NO_BUILT_IN: readonly ContractDescription[] = []

function describeCollection(
  collection: ResolvedCollection,
  builtIn: readonly ContractDescription[],
): SiteDescription['collections'][number] {
  return {
    name: collection.name,
    schema: toJsonSchema(collection.schema),
    routes: { ...collection.routes },
    translationGroupField: collection.translationGroupField,
    tagsField: collection.tagsField,
    sortByField: collection.sortByField,
    components: [...collection.components].map(([name, component]) => ({
      name,
      description: component.description ?? null,
      example: component.example ?? null,
      props: toJsonSchema(component.props),
    })),
    // Every contract is described the way the contracts module describes one, so the phases of a
    // rule read the same here as in its verdicts.
    contracts: [...builtIn, ...collection.contracts].map((contract) => describeContract(contract)),
    maxMarkdownBytes: collection.maxMarkdownBytes,
    styleGuide: collection.styleGuide,
  }
}

/** Freezes the value and everything inside it, so that a caller cannot change what is shared. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

/** Descriptions by site, then by the array of built-in contracts they were made with. */
const descriptions = new WeakMap<
  ResolvedSite,
  WeakMap<readonly ContractDescription[], SiteDescription>
>()

/**
 * What an agent reads before it writes: for each collection, the JSON Schema of the frontmatter
 * (draft 2020-12, as the schema accepts it) and of each component's props, the routes, the
 * fields (the translation group, the tags and the sorting field), the contracts and the style
 * guides. `builtInContracts` are described before the collection's own ones.
 *
 * Converting the schemas costs about 1.4 ms for a realistic site, so the description is made once
 * per site and per array of built-in contracts (pass the same array every time), and every call
 * after that returns the same object, which is frozen because it is shared by every request of
 * the isolate. Collections, components and contracts come in the order of the config.
 */
export function describeResolvedSite(
  site: ResolvedSite,
  options: { readonly builtInContracts?: readonly ContractDescription[] } = {},
): SiteDescription {
  const builtIn = options.builtInContracts ?? NO_BUILT_IN
  let bySite = descriptions.get(site)
  if (bySite === undefined) {
    bySite = new WeakMap()
    descriptions.set(site, bySite)
  }
  let description = bySite.get(builtIn)
  if (description === undefined) {
    description = deepFreeze({
      key: site.key,
      locales: [...site.locales],
      defaultLocale: site.defaultLocale,
      styleGuide: site.styleGuide,
      collections: [...site.collections.values()].map((collection) =>
        describeCollection(collection, builtIn),
      ),
    })
    bySite.set(builtIn, description)
  }
  return description
}
