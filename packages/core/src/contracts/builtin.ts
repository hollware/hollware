import { COMPONENTS } from './components.ts'
import { type ContractDescription, describeContract } from './description.ts'
import { DISALLOWED_ATTRIBUTE, RAW_HTML, UNKNOWN_COMPONENT, UNSAFE_URL } from './safety.ts'
import type { Contract } from './types.ts'

/**
 * Every id Hollware's own contracts use. The config module reserves them: a contract of a site
 * cannot take one, except through `contracts.*`, which makes the opt-in ones.
 *
 * - Always on, run by `runContracts`: `schema`, `components` and the four content-safety
 *   contracts, `raw-html`, `unknown-component`, `disallowed-attribute` and `unsafe-url`.
 * - Opt-in, listed in a collection's `contracts`: `translation-pair`, `internal-links-resolve`
 *   and `images-have-alt`.
 * - Always on, found before the contracts run: `size-limit` (made by the pipeline for
 *   `maxMarkdownBytes` and by the store for the row, with `sizeLimitViolation`),
 *   `frontmatter-syntax` and `comark-parse` (made by the pipeline), and `unique-slug` and
 *   `unique-translation` (made when the store finds the slug or the translation group taken). A
 *   write with one of them is `refused`, so no verdict is made for it: they are
 *   `REFUSAL_CONTRACT_IDS`.
 */
export const BUILT_IN_CONTRACT_IDS = [
  'schema',
  'components',
  'raw-html',
  'unknown-component',
  'disallowed-attribute',
  'unsafe-url',
  'translation-pair',
  'internal-links-resolve',
  'images-have-alt',
  'size-limit',
  'frontmatter-syntax',
  'comark-parse',
  'unique-slug',
  'unique-translation',
] as const

export type BuiltInContractId = (typeof BUILT_IN_CONTRACT_IDS)[number]

/**
 * The ids of the violations that make a write `refused` instead of saving it: a file that cannot
 * be stored, because it is over a size limit, its frontmatter is not YAML or its Markdown does not
 * parse, or whose slug or translation group another entry holds. Every other violation is saved
 * with the draft and only blocks publishing. Plain strings, so that a violation's `contract` can be
 * looked up in the list.
 */
export const REFUSAL_CONTRACT_IDS: readonly string[] = [
  'size-limit',
  'frontmatter-syntax',
  'comark-parse',
  'unique-slug',
  'unique-translation',
]

export const SCHEMA_CONTRACT: Omit<Contract<unknown>, 'check'> = {
  id: 'schema',
  severity: 'error',
  description:
    'The frontmatter matches the schema of the collection, which describe_site shows as JSON Schema.',
}

export const ALWAYS_ON_CONTRACTS: readonly Contract<unknown>[] = [
  COMPONENTS,
  RAW_HTML,
  UNKNOWN_COMPONENT,
  DISALLOWED_ATTRIBUTE,
  UNSAFE_URL,
]

const PIPELINE_CONTRACTS: readonly Omit<Contract<unknown>, 'check'>[] = [
  {
    id: 'size-limit',
    severity: 'error',
    description: 'The whole Markdown file stays within the size limit of the collection.',
  },
  {
    id: 'frontmatter-syntax',
    severity: 'error',
    description: 'The frontmatter is valid YAML between two --- lines at the top of the file.',
  },
  {
    id: 'comark-parse',
    severity: 'error',
    description: 'The Markdown parses.',
  },
  {
    id: 'unique-slug',
    severity: 'error',
    description: 'No other entry of the collection and locale has the slug.',
  },
  {
    id: 'unique-translation',
    severity: 'error',
    description: 'No other entry of the collection and locale belongs to the translation group.',
  },
]

/**
 * The always-on contracts as `describe_site` shows them, in `BUILT_IN_CONTRACT_IDS` order. The
 * opt-in ones are not here: a collection that uses one lists it in its own `contracts`.
 */
export function describeBuiltInContracts(): ContractDescription[] {
  return [SCHEMA_CONTRACT, ...ALWAYS_ON_CONTRACTS, ...PIPELINE_CONTRACTS].map((contract) =>
    describeContract(contract),
  )
}
