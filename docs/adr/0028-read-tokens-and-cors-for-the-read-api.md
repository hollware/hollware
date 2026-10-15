# ADR-028: Read tokens, and CORS for the read API

Status: Accepted (2026-10-15)

## Context

A site that is not a Worker of the same account reads Hollware over the read API (`GET /v1/…`), with a personal token. A personal token writes too, so it cannot sit in a site's build settings, let alone in a browser. And the Host and Origin guard (ADR-019) refuses every request from a page of another origin, so no browser reads the API at all.

## Decision

- **Read tokens.** `hw_read_` and the same 52 characters as a personal token, stored in `tokens` with `kind = 'read'` (migration `0007_read_tokens.sql`, a column with its own CHECK). The check accepts a token only when its prefix and the kind of its row agree. A read token is a principal of its own kind, `read`, whose scopes are `content:read` while its user's role has it, and nothing else.
- **Where a read token works.** The read API alone, which serves published content only. The gateway refuses it at `/mcp`, at `POST /v1/ops/{name}` and at the admin's routes, with a 403 that says what it is for.
- **Making one.** `hollware token create --read` and the admin (`POST /v1/admin/tokens` with `kind: "read"`); both store `content:read` whatever else is asked for.
- **CORS.** A site lists the origins of its pages in its config (`cors: { origins: [...] }`, each an origin). The guard lets a page of a listed origin through for `GET`, `HEAD` and `OPTIONS` of the read API, never the admin's routes, and nothing else. A preflight is answered from the origins of every site, since it carries no token; the read then checks the origin against the site of the token, answers with `Access-Control-Allow-Origin` and exposes the `ETag`, and refuses the origin of another site with a 403 that only Hollware's own origin may read.

## Consequences

- A site can keep a read token in its build settings, or ship one to a browser, without the risk of a token that writes or reads drafts.
- A read token in a browser is public: anyone can read the published content with it, which is what a published site shows anyway, and anyone can make it count against the Worker's requests. It can be revoked like any token.
- The OAuth library reflects the `Origin` onto the responses of protected routes unless a response sets its own header; the read API sets its own on every answer it makes for a page.

## Alternatives considered

- A public read API with no token. Postponed: it would need its own rate limits and a way to turn it off per site.
- Personal tokens with `content:read` only. Rejected: such a token still reads drafts over MCP, and nothing tells it apart from one that a person might widen later.
