import type { Effect, OperationName } from '@hollware/core'
import type { ToolAnnotations } from '@modelcontextprotocol/server'

/**
 * The MCP hints of each effect (ADR-017 and the v0.1 plan). A `read` is read-only and
 * idempotent; an `edit` or a `write` is neither read-only nor destructive; a `destructive`
 * operation is destructive, and repeating it changes nothing more. Every tool is closed-world
 * except the few in `OPEN_WORLD`.
 */
export const EFFECT_ANNOTATIONS = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  edit: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  write: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  destructive: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const satisfies Record<Effect, ToolAnnotations>

/**
 * The tools that ask a third party the site's owner chose (ADR-040): the provider of its analytics.
 * They are open-world; every other tool stays inside the deployment.
 */
export const OPEN_WORLD: ReadonlySet<OperationName> = new Set([
  'connect_analytics',
  'content_stats',
])

/** The MCP hints of an operation: those of its effect, open-world where it reaches a third party. */
export function annotationsOf(name: OperationName, effect: Effect): ToolAnnotations {
  return OPEN_WORLD.has(name)
    ? { ...EFFECT_ANNOTATIONS[effect], openWorldHint: true }
    : EFFECT_ANNOTATIONS[effect]
}
