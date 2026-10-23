import type { ResolvedCollection, ResolvedSite } from '../config/types.ts'
import type { ContractContext } from './types.ts'

export interface Runtime {
  readonly site: ResolvedSite
  readonly collection: ResolvedCollection
}

const RUNTIMES = new WeakMap<object, Runtime>()

export function bindRuntime(context: ContractContext<unknown>, runtime: Runtime): void {
  RUNTIMES.set(context, runtime)
}

export function runtimeOf(contractId: string, context: ContractContext<unknown>): Runtime {
  const runtime = RUNTIMES.get(context)
  if (runtime === undefined) {
    throw new Error(`The built-in contract ${contractId} runs only through runContracts.`)
  }
  return runtime
}
