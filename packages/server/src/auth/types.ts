import type { Scope } from '@hollware/core'

/**
 * Who calls an operation. The gateway turns each request into a principal before any handler
 * runs, and the handlers check their scopes against it at call time (ADR-019).
 */
export type Principal =
  | {
      /** A personal token. */
      readonly kind: 'token'
      readonly userId: string
      readonly tokenId: string
      /** The site the token belongs to; it never reaches another one. */
      readonly site: string
      /** The token's own scopes intersected with those of its user's role, as of now. */
      readonly scopes: readonly Scope[]
    }
  | {
      /** A Worker of the same account, over the RPC binding: it reads published content. */
      readonly kind: 'binding'
      readonly scopes: readonly ['content:read']
    }
