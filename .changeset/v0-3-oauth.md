---
'@hollware/core': minor
'@hollware/server': minor
---

The OAuth server of ADR-026. `/mcp` and `/v1` are OAuth protected resources: a request without a token gets a 401 whose challenge names their metadata, and MCP clients that speak OAuth, such as claude.ai, sign in through `/authorize`, where a person with a passkey allows them the scopes their role has. Personal tokens work as before. A project needs a KV namespace bound as `OAUTH_KV` and the `global_fetch_strictly_public` compatibility flag; `auth: { dynamicClientRegistration: true }` in the config lets clients register themselves.
