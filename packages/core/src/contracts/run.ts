import type { ResolvedCollection, ResolvedSite } from '../config/types.ts'
import type { ProcessedMarkdown } from '../markdown/types.ts'
import { ALWAYS_ON_CONTRACTS, SCHEMA_CONTRACT } from './builtin.ts'
import { contractPhases, describeContract } from './description.ts'
import { hashContracts } from './hash.ts'
import { readsFrontmatter } from './registry.ts'
import { bindRuntime } from './runtime.ts'
import { checkFrontmatter, schemaSnapshot } from './schema.ts'
import { clip, compareText, quote } from './text.ts'
import type {
  Contract,
  ContractContext,
  ContractFinding,
  EntryLookup,
  Phase,
  Verdict,
  Violation,
} from './types.ts'

export interface RunContractsInput {
  readonly site: ResolvedSite
  readonly collection: ResolvedCollection
  readonly locale: string
  readonly slug: string
  /** The entry's id, or `null` while the entry is being created. */
  readonly entryId: string | null
  /**
   * `write` runs the contracts that are declared for it. `publish` (for `validate` and `publish`)
   * runs every contract, so that its verdict lists everything that blocks publishing.
   */
  readonly phase: Phase
  readonly markdown: ProcessedMarkdown
  /** The other entries of the site, for the contracts that look at them. */
  readonly entries: EntryLookup
}

/** The contracts after `schema` that a run has to run: the always-on ones, then the collection's own. */
function contractsFor(collection: ResolvedCollection, phase: Phase): readonly Contract<unknown>[] {
  const all = [...ALWAYS_ON_CONTRACTS, ...collection.contracts]
  return phase === 'publish'
    ? all
    : all.filter((contract) => contractPhases(contract).includes('write'))
}

/** Findings by line, then by path; one without a line comes first. The sort is stable. */
function compareFindings(left: ContractFinding, right: ContractFinding): number {
  return (left.line ?? 0) - (right.line ?? 0) || compareText(left.path, right.path)
}

/**
 * The findings of one contract as violations of it, in order. A finding whose fix is empty, which
 * the type cannot rule out, gets the description of the rule instead, so that no violation ever
 * reaches an agent without something to do.
 */
function toViolations(
  contract: Omit<Contract<unknown>, 'check'>,
  findings: readonly ContractFinding[],
): Violation[] {
  return findings.toSorted(compareFindings).map((finding) => ({
    contract: contract.id,
    severity: contract.severity,
    path: finding.path,
    message: finding.message,
    fix:
      finding.fix.trim() === ''
        ? `Change the entry so that the rule ${quote(contract.id)} passes: ${contract.description}`
        : finding.fix,
    ...(finding.line === undefined ? {} : { line: finding.line }),
  }))
}

function describeError(error: unknown): string {
  try {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  } catch {
    return 'an error that cannot be described'
  }
}

/** What a contract that throws becomes: an error of that contract, and a fix for the maintainer. */
function thrown(contract: Pick<Contract<unknown>, 'id'>, error: unknown): Violation {
  return {
    contract: contract.id,
    severity: 'error',
    path: '',
    message: `The contract ${quote(contract.id)} failed with an error while it checked this entry: ${clip(describeError(error), 200)}`,
    fix: `This is a problem in the config of the site, not in the entry: report it to whoever maintains the config, naming the contract ${quote(contract.id)}.`,
  }
}

async function settle(
  contract: Contract<unknown>,
  context: ContractContext<unknown>,
): Promise<Violation[]> {
  try {
    return toViolations(contract, await contract.check(context))
  } catch (error) {
    return [thrown(contract, error)]
  }
}

/** The schema's verdict on the frontmatter: whether it passed, what it returned and what it found. */
async function validateFrontmatter(
  collection: ResolvedCollection,
  markdown: ProcessedMarkdown,
): Promise<{ passed: boolean; value: unknown; violations: Violation[] }> {
  try {
    const check = await checkFrontmatter(collection, markdown.frontmatter)
    return check.passed
      ? { passed: true, value: check.value, violations: [] }
      : {
          passed: false,
          value: undefined,
          violations: toViolations(SCHEMA_CONTRACT, check.findings),
        }
  } catch (error) {
    return { passed: false, value: undefined, violations: [thrown(SCHEMA_CONTRACT, error)] }
  }
}

/**
 * Runs the contracts of a collection on one revision (ADR-004).
 *
 * The `schema` contract goes first. The collection's own contracts, which read the frontmatter,
 * run only when it passed, and get what the schema returned; the built-in ones that do not need
 * it run anyway, so that one verdict lists as much as it can; the context of those has no
 * frontmatter (`undefined`) when the schema refused it. A contract that throws does not break
 * the run: it becomes an error of that contract.
 *
 * The violations come in a fixed order: the built-in contracts in their own order, then the
 * collection's in the order of its config, and the findings of each one by line and then by path.
 */
export async function runContracts(input: RunContractsInput): Promise<Verdict> {
  const { site, collection, phase, markdown } = input
  const contracts = contractsFor(collection, phase)
  const frontmatter = await validateFrontmatter(collection, markdown)

  const context: ContractContext<unknown> = Object.freeze({
    site: site.key,
    collection: collection.name,
    locale: input.locale,
    slug: input.slug,
    entryId: input.entryId,
    phase,
    frontmatter: frontmatter.value,
    markdown,
    entries: input.entries,
  })
  bindRuntime(context, { site, collection })

  const violations = [...frontmatter.violations]
  for (const contract of contracts) {
    if (!frontmatter.passed && readsFrontmatter(contract)) continue
    violations.push(...(await settle(contract, context)))
  }
  const errors = violations.filter((violation) => violation.severity === 'error')
  const warnings = violations.filter((violation) => violation.severity === 'warning')
  return {
    ok: errors.length === 0,
    phase,
    errors,
    warnings,
    contractsHash: await hashContracts(
      schemaSnapshot(collection),
      [SCHEMA_CONTRACT, ...contracts].map((contract) => describeContract(contract)),
    ),
  }
}
