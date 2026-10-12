# Hollware v0.1 spikes (2026-10-12)

An archive, not code that runs from this branch. These are the feasibility spikes that the
v0.1 plan ran before its first wave, kept so that the work packages can port what they
proved: the SQL of the append-only triggers, the typed D1 session adapter, the memoized MCP
schemas, the safe Comark configuration, the software authenticator and the role-based OAuth
topology.

Each folder was an app, `apps/spike-<name>/`, inside an isolated clone of
`hollware/hollware` at `94d5125`, with its dependencies installed there. Build output,
generated Worker types, logs and raw conformance results are left out. To run one again, put
the folder back under `apps/` of a clone of that commit and install the versions below.

| Folder     | Spike                                                         | Versions                                                                                       |
| ---------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `hono-mcp` | S1 Hono 5, S2 MCP SDK in workerd, S8 MCP conformance          | hono 5.0.0-rc.1, `@modelcontextprotocol/server` and `client` 2.3.1, conformance 0.2.0-alpha.12, zod 4.6.5 |
| `comark`   | S3 Comark and `@comark/html` in workerd                       | comark 0.7.0, `@comark/html` 0.7.0                                                             |
| `d1`       | S4 D1 with drizzle: optimistic write, triggers, sessions      | drizzle-orm 0.45.4, drizzle-kit 0.31.11                                                        |
| `auth`     | S5 SimpleWebAuthn with a software authenticator               | `@simplewebauthn/server` 14.0.3                                                                |
| `oauth`    | workers-oauth-provider with Hono 5, both topologies           | `@cloudflare/workers-oauth-provider` 1.2.3, hono 5.0.0-rc.1                                    |

The toolchain was vite-plus 1.1.0, wrangler 4.149.0 (workerd 1.20261006.1),
`@cloudflare/vite-plugin` 1.63.1, `@cloudflare/vitest-plugin` 1.4.0, TypeScript 7.0.2 and
Node 24.

`RESULTS.md` holds the orchestrator's notes: what each spike found, what was re-run and
which mutations were caught. The verdicts and what they changed are recorded in `PLAN.md`
and in ADR-016 to ADR-020 on `main`.
