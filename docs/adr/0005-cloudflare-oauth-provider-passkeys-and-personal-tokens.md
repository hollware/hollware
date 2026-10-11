# ADR-005: Cloudflare OAuth provider, passkeys and personal tokens

Status: Accepted (2026-10-11)

## Context

MCP clients authenticate through OAuth. `@cloudflare/workers-oauth-provider` covers what the 2026-07-28 MCP specification needs on the authorization side: Client ID Metadata Documents (CIMD), RFC 9728 and RFC 8707 (resource metadata and resource indicators, which bind a token to its audience) and scopes per tool, with `insufficient_scope` responses and a consent screen. Its state lives in KV.

Humans need to sign in to the admin and to approve MCP clients. Passkeys let an instance start with no email provider, no third-party OAuth apps and no Zero Trust setup.

Bundle size matters on Workers: a heavier bundle costs more CPU when an isolate starts, and the Free plan gives 10 ms of CPU per request. Measured gzipped, the OAuth provider plus SimpleWebAuthn weighs 115 KB and uses no Node APIs. Better Auth, with its mcp, cimd, passkey and api-key plugins, weighs 460 KB and requires `nodejs_compat`.

## Decision

- `@cloudflare/workers-oauth-provider` 1.2.x is the authorization server, with its state in KV. Dynamic client registration is kept only for compatibility.
- Humans use passkeys, implemented with `@simplewebauthn/server`. `hollware init` prints a single-use link for the owner to register a passkey. Collaborators join by invitation. Roles live in D1 and translate into the scopes `content:read`, `content:write` and `content:publish`, plus `schema:admin`.
- Personal tokens serve automations over MCP and HTTP. They are hashed in D1 together with their scopes, an expiry and a revocation date, and the token itself is never stored.
- Sites read either through a service binding, which needs no token, or with read-only tokens over HTTP. Published content can optionally be public.
- Cloudflare Access is an optional mode for teams: when its JWT is present, the passkey step is skipped.

## Consequences

- Authorization checks scopes, never roles. The effective scopes of a request are the scopes of the token intersected with the scopes of its user's current role, so a token is never worth more than its user is today. When scopes are missing, the server answers `403 insufficient_scope`, and the client can ask for more.
- Getting started needs no external setup: no email provider, no OAuth apps and no Zero Trust.
- Authentication adds about 115 KB gzipped to the Worker, with no Node compatibility flag.
- KV on the Free plan allows 1,000 writes a day, which is plenty for a team with agents.
- SimpleWebAuthn 14 does not list Workers as an official platform. A spike in v0.1 verifies it in workerd, with `nodejs_compat` as the fallback.
- Cloudflare Access stays optional, so Hollware never depends on Zero Trust.

## Alternatives considered

- Better Auth. Rejected: it is four times heavier (460 KB against 115 KB gzipped) and requires `nodejs_compat`.
- Cloudflare Access as the only way in. Rejected: it requires a Zero Trust setup before anything works. It stays as an optional mode.
- Email sign-in or third-party OAuth apps for humans. Rejected: they need an email provider or external app registrations, and passkeys need neither.
