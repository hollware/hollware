import type { ResolvedCollection, ResolvedSite } from '../config/types.ts'
import type { ContractContext } from './types.ts'

/**
 * What the built-in contracts need besides what a site's own contracts see: the site and the
 * collection as the config resolved them (the components a collection allows, the locales of the
 * site, the field that holds the translation group). `ContractContext` stays as ADR-004 pinned it,
 * so the runner keeps this beside the context instead of inside it: a contract can only get it
 * from a context the runner made.
 */
export interface Runtime {
  readonly site: ResolvedSite
  readonly collection: ResolvedCollection
}

const RUNTIMES = new WeakMap<object, Runtime>()

/** Records the runtime of the context a run hands to its contracts. */
export function bindRuntime(context: ContractContext<unknown>, runtime: Runtime): void {
  RUNTIMES.set(context, runtime)
}

/** The runtime of a context. A built-in contract called by hand, with a context of its own, throws. */
export function runtimeOf(contractId: string, context: ContractContext<unknown>): Runtime {
  const runtime = RUNTIMES.get(context)
  if (runtime === undefined) {
    throw new Error(`The built-in contract ${contractId} runs only through runContracts.`)
  }
  return runtime
}
