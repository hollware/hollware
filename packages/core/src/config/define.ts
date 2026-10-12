import type { Contract } from '../contracts/types.ts'
import type {
  CollectionDefinition,
  ComponentDefinition,
  DescribedSchema,
  HollwareConfig,
} from './types.ts'

/**
 * The `define*` helpers only give the config its types: the frontmatter type of a collection
 * flows from its schema into its contracts. Validating the config is the job of the config
 * module, when the Worker starts.
 */

/** Declares the config of a deployment: what `hollware.config.ts` exports. */
export function defineConfig(config: HollwareConfig): HollwareConfig {
  return config
}

/** Declares a collection. Its contracts see the frontmatter that its schema returns. */
export function defineCollection<const Schema extends DescribedSchema>(
  collection: CollectionDefinition<Schema>,
): CollectionDefinition<Schema> {
  return collection
}

/** Declares a component that entries may use in their body. */
export function defineComponent(component: ComponentDefinition): ComponentDefinition {
  return component
}

/**
 * Declares a contract shared by several collections, with the frontmatter type it reads given
 * explicitly: `defineContract<{ title: string }>({ … })`. Inside `defineCollection`, write a
 * contract as a plain object instead: its `check` gets the frontmatter type of the schema there,
 * which a generic call inside the array would lose.
 */
export function defineContract<Frontmatter = Record<string, unknown>>(
  contract: Contract<Frontmatter>,
): Contract<Frontmatter> {
  return contract
}
