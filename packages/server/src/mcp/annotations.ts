import type { Effect } from '@hollware/core'
import type { ToolAnnotations } from '@modelcontextprotocol/server'

/**
 * The MCP hints of each effect (ADR-017 and the v0.1 plan). A `read` is read-only and
 * idempotent; an `edit` or a `write` is neither read-only nor destructive; a `destructive`
 * operation is destructive, and repeating it changes nothing more. No tool reaches outside the
 * deployment, so every tool is closed-world.
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
