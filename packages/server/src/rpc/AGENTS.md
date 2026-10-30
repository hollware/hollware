# src/rpc

What other Workers of the account call over a service binding. Two classes, each exported by the
user's Worker under its own name:

- `Hollware` (`entrypoint.ts`) is what sites read: the class has the seven methods of `HollwareRpc`
  and nothing else, because everything on its prototype is callable. Each call checks its site,
  parses its input with the spec, and runs on the published view with a binding principal and a
  replica session. An error crosses a binding with its `cause`, so a failure reaches the caller
  rebuilt without it (`forCaller`), or as `internal`, and the cause goes to the log.
- `HollwareOps` (`ops-entrypoint.ts`) is a class apart, so `Hollware` keeps its seven methods: any
  operation (`ops`) or MCP (`fetch`), with no Host guard, always as a personal token checked on the
  primary. The site, the scopes and the actor come from the token; the context is the gateway's,
  from `packages/server/src/http/operation-context.ts`.
