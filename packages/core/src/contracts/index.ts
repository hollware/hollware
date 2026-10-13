/**
 * Contracts (ADR-004, ADR-020): the shapes of a verdict, the runner that makes one, the built-in
 * contracts and the factories a config uses. `packages/core/src/index.ts` re-exports this.
 */

export {
  BUILT_IN_CONTRACT_IDS,
  describeBuiltInContracts,
  REFUSAL_CONTRACT_IDS,
  type BuiltInContractId,
} from './builtin.ts'
export { describeContract, type ContractDescription } from './description.ts'
export {
  contracts,
  type BuiltInOptions,
  type ContractText,
  type CustomContractOptions,
} from './opt-in.ts'
export { isBuiltInContract } from './registry.ts'
export { runContracts, type RunContractsInput } from './run.ts'
export { sizeLimitViolation } from './size.ts'
export type {
  AcknowledgedWarning,
  Contract,
  ContractContext,
  ContractFinding,
  EntryFacts,
  EntryLookup,
  EntryRef,
  Phase,
  Severity,
  Verdict,
  Violation,
} from './types.ts'
