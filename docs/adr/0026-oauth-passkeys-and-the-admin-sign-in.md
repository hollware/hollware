# ADR-026: OAuth, passkeys and the admin's sign-in

Status: Accepted (2026-10-14)

## Context

[ADR-019](0019-personal-tokens-in-v0-1-oauth-with-the-admin.md) brings OAuth, passkeys, setup links, invitations, sign-in and consent with the admin in v0.3, through the role-based API of `@cloudflare/workers-oauth-provider`, and leaves open dynamic client registration, the address filter for client metadata documents, the token lifetimes against the KV budget, the roles and the SimpleWebAuthn traps. The maintainer chose the full OAuth server for v0.3 (2026-10-14).

## Decision

- **One Worker, two roles.** An `OAuthAuthorizationServer` and an `OAuthResourceServer` per protected route, `/mcp` and `/v1`, in the Worker that `createHollware` builds. The Host and Origin guard still runs first. The resource server's `validateToken` asks the authorization server, and a token of the shape `hw_pat_…` goes to D1 as before, so personal tokens keep working unchanged. The props of a grant hold the user and the site; the effective scopes are the grant's intersected with the user's role now.
- **Roles.** `owner`: every scope; `editor`: `content:read`, `content:write`, `content:publish`; `author`: `content:read`, `content:write`.
- **Clients.** Client ID Metadata Documents are accepted, fetched with `global_fetch_strictly_public`. Dynamic client registration is off unless the config turns it on. The admin is a first-party public client: its metadata document is served at `/admin/client.json`, it uses PKCE, and it gets no consent page.
- **Tokens.** Access tokens live one hour and refresh tokens thirty days, rotated on use; with the Free plan's 1,000 KV writes a day, that is a few hundred refreshes a day, enough for a team's admin and a handful of agents.
- **People.** A person signs in with a passkey (SimpleWebAuthn, with the RP ID always given and no shared option objects). The first owner gets a single-use setup link from `hollware init`; others get invitations that carry a role and expire. A signed-in person has a session cookie that `/authorize` alone reads (`HttpOnly`, `Secure`, `SameSite=Lax`, path `/authorize`), so the admin reauthorizes without a new passkey ceremony; `/mcp` and `/v1` never read a cookie.
- **Pages.** Setup, sign-in, invitation and consent are pages that the Worker renders itself, with the WebAuthn calls inline: they are outside the admin's bundle, and the consent page is framed by nothing (`frame-ancestors 'none'`).
- **The admin.** A Vue single-page app at `/admin`, which keeps the access token in memory only and reaches Hollware through the same operations as an agent, over `/v1` and a write route of the same shape.

## Consequences

- MCP clients that only speak OAuth, such as claude.ai connectors, can connect, after a person signs in and consents.
- A project needs a KV namespace bound as `OAUTH_KV`, and a migration adds passkeys, invitations, setup links and roles.
- Every surface keeps one way to check scopes: what an operation needs, against the principal's effective scopes.

## Alternatives considered

- A session of the admin's own, with OAuth for third parties in v0.4. Rejected by the maintainer, who wants the full OAuth server now.
- The combined `OAuthProvider` class. Rejected as in ADR-019: the role-based API keeps the guard, the scope checks and personal tokens under Hollware's control.
- Consent inside the admin's single-page app. Rejected: it would tie the authorization server to the admin's bundle, and a page the Worker renders is harder to frame or script into approving.
