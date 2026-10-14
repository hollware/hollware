# ADR-006: One deployment per account, several sites inside

Status: Accepted (2026-10-14)

## Context

A team often has more than one site: a blog and a documentation site, or one site per brand. Each site needs its own collections and its own access, but running a separate Hollware deployment for each would multiply the infrastructure to operate and upgrade. Hollware's own documentation is meant to be written in Hollware and to run as a second site next to the first one.

## Decision

Several sites live in one Hollware deployment, and each Cloudflare account has one deployment. Every table carries `site_id` from v0.1, even while there is a single site, and child tables repeat it so that foreign keys can include it.

This is not multi-tenant SaaS: each organization deploys its own Hollware. Isolation between sites is enforced in the data, not in the infrastructure.

## Consequences

- Sites share one D1 database, one KV namespace and one bill, which keeps a deployment inside the free tiers.
- Isolation is logical, so a query that forgets `site_id` would leak data. Three mechanisms guard against it: composite foreign keys (`UNIQUE(id, site_id)`) and CHECK constraints in the schema, a schema test that fails when a table lacks `site_id` (its list of exceptions can only shrink), and a "stranger" test for every operation that proves ids from another site fail.
- From v0.4, when a second site arrives, OAuth grants, personal tokens, read tokens and the props of a service binding always carry the set of sites they may touch.
- There is no per-site billing, quota or infrastructure isolation. Teams that need those deploy separate instances.
- This ADR is proposed. It is confirmed, or replaced, when the v0.1 data model is implemented. `site_id` on every table does not wait for that, because adding it later would mean rewriting every table.

## Alternatives considered

- One deployment per site. Simple isolation, but every site repeats the infrastructure and the upgrade work.
- Multi-tenant SaaS, where one operator hosts many organizations. Out of scope: it needs billing, per-tenant isolation and an operating model that a project deployed to each organization's own Cloudflare account does not have.
