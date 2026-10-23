import type { Contract } from './types.ts'

const BUILT_INS = new WeakMap<object, { readonly readsFrontmatter: boolean }>()

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

export function readsFrontmatter(contract: Contract<unknown>): boolean {
  return BUILT_INS.get(contract)?.readsFrontmatter ?? true
}
