import type { ScopeChallengeHandler } from '@modelcontextprotocol/server'
import type { Tool } from './tools.ts'

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
