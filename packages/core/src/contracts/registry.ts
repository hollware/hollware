import type { Contract } from './types.ts'

/**
 * The contracts that Hollware makes itself, as opposed to the ones a site writes. The runner
 * needs to know one thing about them that a `Contract` does not say: whether the rule reads the
 * frontmatter, because a rule that does only runs once the schema has accepted it.
 */
const BUILT_INS = new WeakMap<object, { readonly readsFrontmatter: boolean }>()

/** Marks a contract as one of Hollware's own and returns it. */
export function registerBuiltIn<Built extends Contract<unknown>>(
  contract: Built,
  options: { readonly readsFrontmatter: boolean },
): Built {
  BUILT_INS.set(contract, options)
  return contract
}

/**
 * Whether a contract was made by Hollware: the always-on ones and what the factories of
 * `contracts` return. A site's own contract with the id of a built-in one is not.
 */
export function isBuiltInContract(contract: Contract<unknown>): boolean {
  return BUILT_INS.has(contract)
}

/** Whether a contract only runs once the schema has accepted the frontmatter. */
export function readsFrontmatter(contract: Contract<unknown>): boolean {
  return BUILT_INS.get(contract)?.readsFrontmatter ?? true
}
