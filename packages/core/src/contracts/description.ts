import type { contractDescription } from '../operations/schemas.ts'
import type * as z from 'zod'
import type { Contract, Phase } from './types.ts'

/** The phases, in the order they happen. */
const PHASES: readonly Phase[] = ['write', 'publish']

/** What `describe_site` shows of a contract. */
export type ContractDescription = z.output<typeof contractDescription>

/**
 * The phases a contract is declared for: both when it names none, in their natural order and
 * without repeats, so that the same rule always reads the same.
 */
export function contractPhases(contract: Pick<Contract<unknown>, 'phases'>): Phase[] {
  const declared = contract.phases ?? PHASES
  return PHASES.filter((phase) => declared.includes(phase))
}

/** A contract as `describe_site` shows it to agents. */
export function describeContract(
  contract: Pick<Contract<unknown>, 'id' | 'severity' | 'phases' | 'description'>,
): ContractDescription {
  return {
    id: contract.id,
    severity: contract.severity,
    phases: contractPhases(contract),
    description: contract.description,
  }
}
