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
      /** An access token of the OAuth server (ADR-026): a person, through a client they allowed. */
      readonly kind: 'oauth'
      readonly userId: string
      /** The client the person allowed: a Client ID Metadata Document URL, or a registered id. */
      readonly clientId: string
      readonly site: string
      /** The scopes of the grant intersected with those of the user's role, as of now. */
      readonly scopes: readonly Scope[]
    }
  | {
      /** A Worker of the same account, over the RPC binding: it reads published content. */
      readonly kind: 'binding'
      readonly scopes: readonly ['content:read']
    }

/** A principal of a request over HTTP: a person or their token, and always of one site. */
export type RequestPrincipal = Exclude<Principal, { readonly kind: 'binding' }>
