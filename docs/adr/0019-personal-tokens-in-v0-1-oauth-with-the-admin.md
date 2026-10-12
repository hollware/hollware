# ADR-019: Personal tokens in v0.1; OAuth and passkeys arrive with the admin

Status: Accepted (2026-10-12)

## Context

[ADR-005](0005-cloudflare-oauth-provider-passkeys-and-personal-tokens.md) chose `@cloudflare/workers-oauth-provider` for MCP clients, passkeys for humans and personal tokens for automations. It did not set when each part arrives.

The adversarial review of the v0.1 plan found that OAuth needs a surface that a person sees: the single-use setup link, the sign-in with a passkey and the consent page, which the MCP specification requires before a client gets access. That is user interface, and Hollware gets its interface with the admin in v0.3. The v0.1 spikes added more to settle before OAuth ships:

- the provider fits Hollware only through its role-based API;
- it neither enforces scopes nor guards Host and Origin, and it reflects any Origin in CORS;
- each token refresh costs two KV writes, against the 1,000 a day of the Free plan;
- its fetch of client metadata documents is not limited to public addresses;
- SimpleWebAuthn has traps of its own (a shared default object it mutates, an optional RP ID check).

## Decision

- In v0.1, MCP requests authenticate with personal tokens only. A token looks like `hw_pat_…`, `hollware init` prints the owner's first one, and `hollware token create` makes the next ones. D1 stores its hash with its site, its scopes, an expiry (90 days by default) and a revocation date. Clients send it as a bearer token.
- The effective scopes of a request are the token's scopes intersected with its user's current role; in v0.1 the only role is the owner. A missing scope is answered with `403 insufficient_scope`, which names every scope the operation needs in one challenge.
- A Host and Origin guard runs in front of every route and fails closed. The allowed host comes from `HOLLWARE_PUBLIC_URL`, plus an explicit list once a deployment needs a second host (v0.1 has none); without that configuration the Worker answers 500 instead of skipping the check. A request whose Origin is present and not allowed gets 403.
- OAuth, passkeys, setup links, invitations, sign-in and the consent page arrive in v0.3 with the admin:
  - they use the provider's role-based API: an `OAuthAuthorizationServer` and one `OAuthResourceServer` for `/mcp`, with `/v1` joining when the HTTP API exists;
  - its `validateToken` sends personal tokens to D1;
  - v0.3 settles dynamic client registration (off by default), the address filter for client metadata documents, the access token lifetime against the KV budget, the table from roles to scopes, and the SimpleWebAuthn traps recorded in the v0.1 spike.

## Consequences

- v0.1 has no OAuth surface: no consent page to get wrong, no KV write budget and no outbound fetch of client documents.
- Claude Code and scripts connect with a header. Clients that only speak OAuth, such as claude.ai connectors, wait for v0.3.
- Until v0.3, `hollware init` prints a token instead of a passkey link.
- The token table and the scope checks built in v0.1 stay as they are. v0.3 adds OAuth next to them, so a token never changes shape.

## Alternatives considered

- Minimal pages of Hollware's own for setup, sign-in and consent in v0.1. Rejected by the maintainer: a work package of user interface, plus the whole OAuth surface, in the stage meant for the core.
- OAuth without consent, approving every request. Rejected: the MCP specification requires the person to see and approve the client.
