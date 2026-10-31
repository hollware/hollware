---
'@hollware/server': minor
'hollware': minor
---

An agent member can hold a lasting personal token, for an agent that hears no events, such as an MCP gateway: `hollware token create --member <usr_…>` and `member` of `POST /v1/admin/tokens`, for an owner only and never over MCP. Its scopes are an author's at most (content:publish and schema:admin are refused with their fix), what it writes is the agent's, and its publish asks for a review. A token expires when asked like Cloudflare's: in days, at a date (`--expires-at`, `expiresAt`) or never. Removing an agent revokes its tokens with its grants; `hollware token list` and `GET /v1/admin/tokens` say whose each token is.
