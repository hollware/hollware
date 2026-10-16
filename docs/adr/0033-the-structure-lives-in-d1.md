# ADR-033: The structure lives in D1

Status: Proposed (2026-10-16)

## Context

Until 0.7 the structure of a deployment is code: `hollware.config.ts` names the sites, and each site its locales, collections, schemas (Zod), components, contracts, routes, style guides, CORS origins and webhooks. The Worker resolves it at startup, so adding a site, a field or a contract means changing code and deploying. Hollware is meant to be run by one person, or by their agent, with no deploy at all: that is what sets it apart from a content layer in the site's repository, such as Nuxt Content. The maintainer chose (2026-10-16) that D1 holds the structure and nothing else does; that the rules of a collection come from a catalog with parameters, no code; and that an owner, a person or an agent with the permission, changes it.

Two facts make it possible: no config of the repository writes a contract of its own (each one comes from `contracts.*`, so each is data), and the schemas already travel as JSON Schema, which `describe_site` shows.

## Decision

- **D1 is the one source of the structure.** A table `sites` has one row per site: its key, its definition as JSON and its version, with `deleted_at` for the trash. Every change appends the definition before and after to `site_changes`, with its actor, as `audit_log` does. No code declares a site: `createHollware()` takes the deployment's options and no structure.
- **A definition is data checked by a schema of `@hollware/core`.** Locales, the default locale, the public URL, CORS origins, the style guide, events, and the collections: the frontmatter as JSON Schema (draft 2020-12, the subset the admin's form edits plus what an agent may write), routes, the translation, tags and sort fields, components with the JSON Schema of their props, the size limit and the style guide.
- **Rules come from a catalog, with parameters.** A collection lists `{ contract, severity, params }`; each contract of the catalog declares the JSON Schema of its parameters, so the admin builds its form and an agent reads it in `describe_site`. The catalog gains generic rules (a field's length, a pattern, a field required to publish, words that may not appear) next to those of today. No rule is code of the user's.
- **Frontmatter is validated with `@cfworker/json-schema`,** which runs in Workers without `eval`. The schemas a contract hash covers are the stored JSON, so a verdict still says which rules it answered to.
- **The Worker reads a site's definition from D1, through a cache of the isolate** that a version check keeps fresh: a write reads the current definition in its own request; a read may use one a few seconds old.
- **New operations, under a new scope `site:admin`,** which the role owner has and a personal token may carry: `create_site`, `update_site`, `delete_site` (to the trash, with an export kept in R2; purged after 30 days), `restore_site`, `set_collection` and `remove_collection`. A change that would leave entries without a collection, or entries the new schema refuses, says so and asks to confirm, as publish asks for warnings. `describe_site` shows the definition and the catalog.
- **Secrets of the structure live in D1, sealed.** The signing secret of a webhook is made by Hollware, shown once, and stored sealed with AES-GCM under the Worker secret `HOLLWARE_SECRET`; the IndexNow key is public by design and stored as it is.
- **A deployment of 0.x moves once.** On its first start, a Worker whose D1 has no sites and that is given the config of before writes each site of that config as its first definition, and from then on ignores it. New projects have no config.

## Consequences

- Sites, collections, fields, rules and members change from the admin or over MCP, at once, with no deploy.
- A change of structure is audited and can be undone, and a deleted site waits 30 days in the trash.
- Custom rules in code are gone; a rule the catalog lacks is a new rule of the catalog.
- Every request that needs a site reads it from D1 once in a while; a write reads it once.
- The tests seed the structure as data, as the playground's deployments do.

## Alternatives considered

- The config as a seed, kept: two ways to state one thing, which drift. Rejected; it stays only to move a deployment of 0.x.
- Sites of the config, read-only, beside sites made at runtime. Rejected: two kinds of site.
- Plugins of rules in code. Rejected: they bring the deploy back.
- Ajv. Rejected: it compiles schemas with `new Function`, which Workers forbid.
