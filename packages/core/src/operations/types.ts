import type * as z from 'zod'
import type { Scope } from '../scopes.ts'

/**
 * What an operation does to the content. The MCP hints, the HTTP method and whether an answer
 * may be cached derive from it:
 * - `read` changes nothing;
 * - `edit` changes an entry that exists;
 * - `write` creates content or makes it public;
 * - `destructive` takes content away from the public.
 */
export type Effect = 'read' | 'edit' | 'write' | 'destructive'

/** How the surfaces treat an outcome. */
export interface OutcomeInfo {
  /** Whether the outcome is an error for the caller: `isError` over MCP, a 4xx over HTTP. */
  readonly isError: boolean
}

/** The outcomes an output schema allows: the values of its `outcome` field. */
export type OutcomeOf<Output extends z.ZodType> =
  z.output<Output> extends { outcome: infer Outcome extends string } ? Outcome : never

export interface OperationSpec<
  Name extends string = string,
  Input extends z.ZodType = z.ZodType,
  Output extends z.ZodType = z.ZodType,
> {
  /** The tool name over MCP, in snake case: `create_draft`. */
  readonly name: Name
  /** A short human title. */
  readonly title: string
  /** What the operation does and when to use it, written for the agent. */
  readonly description: string
  /** An object schema; adapters reject input that does not match. */
  readonly input: Input
  /** An object schema with an `outcome` field (MCP needs an object at the root). */
  readonly output: Output
  /** Every scope the caller needs. */
  readonly scopes: readonly Scope[]
  readonly effect: Effect
  /** Every outcome of the output, and whether it is an error for the caller. */
  readonly outcomes: Readonly<Record<OutcomeOf<Output>, OutcomeInfo>>
}

/** Declares an operation spec, keeping the literal types of its name and schemas. */
export function defineOperation<
  const Name extends string,
  Input extends z.ZodType,
  Output extends z.ZodType,
>(spec: OperationSpec<Name, Input, Output>): OperationSpec<Name, Input, Output> {
  return spec
}
