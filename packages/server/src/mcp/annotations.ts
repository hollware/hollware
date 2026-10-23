import type { Effect, OperationName } from '@hollware/core'
import type { ToolAnnotations } from '@modelcontextprotocol/server'

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

export const OPEN_WORLD: ReadonlySet<OperationName> = new Set([
  'connect_analytics',
  'content_stats',
])

export function annotationsOf(name: OperationName, effect: Effect): ToolAnnotations {
  return OPEN_WORLD.has(name)
    ? { ...EFFECT_ANNOTATIONS[effect], openWorldHint: true }
    : EFFECT_ANNOTATIONS[effect]
}
