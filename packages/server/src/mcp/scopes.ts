import type { ScopeChallengeHandler } from '@modelcontextprotocol/server'
import type { Tool } from './tools.ts'

/**
 * The scope challenge of a tool, which the SDK asks before it serves a call of the tool. A
 * principal that has every scope the tool needs gets nothing, and the call goes on. One that
 * lacks any of them is refused with 403 and a challenge that names every scope the tool needs,
 * the ones it has included, so that a client that can ask for more asks for all of them at once.
 * A request that comes without scopes is refused too: it never passes by lacking a principal.
 *
 * `onDenied` runs when a call is refused, for the log: the call never reaches the tool.
 */
export function scopeChallenge(tool: Tool, onDenied: () => void): ScopeChallengeHandler {
  return ({ authInfo }) => {
    const granted = new Set(authInfo?.scopes)
    if (tool.scopes.every((scope) => granted.has(scope))) return undefined
    onDenied()
    return {
      scopes: tool.scopes,
      errorDescription: `${tool.spec.name} requires: ${tool.scopes.join(' ')}`,
    }
  }
}
