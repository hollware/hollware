import type { Scope } from '@hollware/core'

/**
 * Who calls an operation. The gateway turns each request into a principal before any handler
 * runs, and the handlers check their scopes against it at call time.
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
      /**
       * Set for an agent's grant (`hw_agt_`): the agent as the site declares it, and the review
       * the grant is for, which is the only one it reads or comments on.
       */
      readonly agent?: { readonly name: string; readonly review: string | null }
    }
  | {
      /** An access token of the OAuth server: a person, through a client they allowed. */
      readonly kind: 'oauth'
      readonly userId: string
      /** The client the person allowed: a Client ID Metadata Document URL, or a registered id. */
      readonly clientId: string
      readonly site: string
      /** The scopes of the grant intersected with those of the user's role, as of now. */
      readonly scopes: readonly Scope[]
    }
  | {
      /**
       * A read token (`hw_read_`): it reads the published content of its site over the read API,
       * and the gateway turns it away from every other route.
       */
      readonly kind: 'read'
      readonly userId: string
      readonly tokenId: string
      readonly site: string
      /** `content:read` while its user's role has it, else nothing. */
      readonly scopes: readonly Scope[]
    }
  | {
      /** A Worker of the same account, over the RPC binding: it reads published content. */
      readonly kind: 'binding'
      readonly scopes: readonly ['content:read']
    }

export type RequestPrincipal = Exclude<Principal, { readonly kind: 'binding' }>
