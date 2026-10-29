---
'@hollware/core': minor
'@hollware/server': minor
'@hollware/client': minor
---

Another Worker of the same account runs any operation, or speaks MCP, over a service binding to the new `HollwareOps` entrypoint, with no check of Host or Origin and always as a personal token (`hw_pat_…`): its site, scopes and the actor of the activity log come from the token, and a read token or a revoked one is refused as `unauthorized`, a new error code. Export it from the project's Worker with `export class HollwareOps extends hollware.HollwareOps {}` and type the binding with `HollwareOpsRpc`. `@hollware/client` adds `createOpsClient({ binding, token })`, whose `call(name, input)` is typed by the operation.
