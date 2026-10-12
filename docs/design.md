# Hollware design document

A headless content backend for the agent era, native to Cloudflare and open source from the first commit.

- **Version:** 0.2, adapted for the repository
- **Date:** 2026-10-11
- **Status:** stack decided
- **License:** MIT
- **Website:** hollware.com
- **Author:** Sergio Azócar

_Hollow_ is empty: a headless CMS that runs on Workers, with no servers to manage. _Hollowware_ is hollow tableware, like teapots and jugs, made to hold and serve. And the name winks at Hallow's End, the World of Warcraft festival where the Headless Horseman appears.

This document is the overview of the design. Every structural decision has its own record in [`docs/adr/`](adr/README.md), and the sections below link to them.

## Contents

- [Thesis](#thesis)
- [Positioning](#positioning)
- [Architecture](#architecture)
- [Flows](#flows)
- [Contracts](#contracts)
- [Surfaces](#surfaces)
- [Data model](#data-model)
- [Repository and stack](#repository-and-stack)
- [Decisions](#decisions)
- [Roadmap](#roadmap)
- [Costs](#costs)
- [Risks and open questions](#risks-and-open-questions)

## Thesis

**Five principles that are not negotiable.** Everything else in this document derives from them. If a future decision contradicts one, either the decision changes or the principle is rewritten in an ADR, never silently.

- **P1. Headless, always.** Hollware does not render sites and has no themes. It delivers content to any frontend: Nuxt, Astro, Next or the app of a product.
- **P2. The agent is the primary editor.** MCP is the first-class interface. The admin exists to review and approve, and everything the admin does can also be done over MCP.
- **P3. Contracts at write time.** Quality rules are validated at the moment of writing. The error returns to the agent in milliseconds with an instruction to fix it, not in a CI pipeline ten minutes later.
- **P4. Markdown is the source of truth.** It is what agents write and read best, and it produces readable diffs. Comark compiles it to a derived JSON document that can be regenerated at any time.
- **P5. Native to Cloudflare, cost close to zero.** Every piece uses a Cloudflare primitive with a free tier. It deploys to your own account. Two sites should cost between $0 and $5 a month.

### Non-goals

- Rendering sites or themes
- A visual page builder
- A plugin marketplace
- Running outside Cloudflare (before v1)
- Importing from WordPress (before v1)

## Positioning

**Where it fits and where it does not.** EmDash aims to be the complete site managed by agents: the WordPress of this era, built for agencies and small businesses. Hollware targets teams that already have their frontend and need a content backend their agents can write to. If EmDash ships a real headless mode, it gets evaluated and the better tool wins.

|                             | Hollware                                              | EmDash                                     | Payload on Workers        | Sanity                             | Nuxt Content          |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------ | ------------------------- | ---------------------------------- | --------------------- |
| **Headless by design**      | Yes                                                   | There is an API, but it deploys with Astro | Yes                       | Yes                                | No, coupled to Nuxt   |
| **Stored format**           | Markdown plus a derived Comark document               | Portable Text                              | Lexical JSON              | Portable Text                      | Markdown in git       |
| **MCP**                     | Primary interface, stateless 2026-07-28 specification | Included                                   | Official plugin           | Official server                    | No                    |
| **Validation**              | Write-time contracts with a fix instruction           | Schema and plugins                         | Schema and hooks          | Schema                             | Schema at build time  |
| **Reading from the site**   | RPC over a service binding, or cacheable HTTP         | HTTP with a token                          | HTTP                      | HTTP (CDN)                         | Build or local SQLite |
| **Publishing without CI**   | Yes                                                   | Yes                                        | Yes                       | Yes                                | No                    |
| **Infrastructure and cost** | Your Cloudflare account, $0 to $5                     | Your Cloudflare account, $0 to $5          | Workers Paid and two apps | Their cloud, free plan with limits | Anything              |

The competitor columns summarize what was found on 2026-10-11 and can go out of date.

## Architecture

**One Cloudflare primitive per responsibility.** D1 is the single source of truth, with read replicas. An operation registry exposes the same core over MCP, RPC and HTTP. Publishing is a durable Workflow. The layers below run from the clients down to storage and intelligence, and every node says what it does, why it is that primitive, the phase in which it arrives and what it costs.

```text
Clients        Agents (MCP) · Admin (v0.3) · Sites (RPC) · Integrations (HTTP, v0.2)
                                         ↓
Edge           Gateway: Worker + Hono 5 (OAuth, passkeys, personal tokens)
                                         ↓
Core           Operations (registry) · Contracts
                                         ↓
Data           D1 (source of truth) · KV (OAuth) · Edge cache (v0.2)
                                         ↓
Publishing     Publish Workflow (v0.2) · Events: Queues (v0.2) · Maintenance: Cron (v0.2)
                                         ↓
Assets and AI  Media: R2 + Images (v0.2) · Semantic: Vectorize + Workers AI (v0.5)
               Metrics: Analytics Engine (v0.5) · Own agents: Agents SDK (v0.5)
```

### Clients

#### Agents (MCP)

Phase: v0.1.

- **What it does:** Claude, Codex, Cursor or any MCP client. They are the primary editors.
- **Why this primitive:** MCP is the protocol every agent already speaks. Since the 2026-07-28 specification it is stateless, so a Worker can serve it without sessions.
- **Cost:** Normal Workers requests.

#### Admin (Vue + Nuxt UI)

Phase: v0.3.

- **What it does:** Entry list, Markdown editor with CodeMirror and a Comark preview, forms generated from the contracts, revision diff and an approval queue.
- **Why this primitive:** It is secondary on purpose. It serves to review and approve what the agent writes, not to write from scratch. See [ADR-007](adr/0007-admin-in-vue-with-nuxt-ui-without-nuxt.md).
- **Cost:** Static assets of the same Worker, so no cost.

#### Sites (RPC)

Phase: v0.1.

- **What it does:** Frontends in the same Cloudflare account, for example a Nuxt or Astro site.
- **Why this primitive:** A service binding with RPC is typed, does not cross the public network and needs no token. No traditional headless CMS can offer this.
- **Cost:** Cloudflare documents that service bindings do not increase costs. Calls still count toward the subrequest limits.

#### Integrations (HTTP + OpenAPI)

Phase: v0.2.

- **What it does:** The admin, sites outside Cloudflare, apps and scripts.
- **Why this primitive:** A standard door for whatever does not live on Cloudflare. Reads are cacheable `GET` requests with an `ETag`, and the OpenAPI 3.1 document is generated from the registry.
- **Cost:** Normal Workers requests.

### Edge

#### Gateway (Worker + Hono 5)

Phase: v0.1.

- **What it does:** The single entry point: OAuth, passkeys and personal tokens. It mounts MCP, HTTP and the static files of the admin, and exposes the RPC entrypoint.
- **Why this primitive:** It concentrates access in one place. Each operation is defined once and exposed on the three surfaces.
- **Cost:** Free tier: 100,000 requests a day and 10 ms of CPU per request.

### Core

#### Operations (`@hollware/core` and `@hollware/server`)

Phase: v0.1.

- **What it does:** The operation registry. Each operation is specified once in `core` (name, Zod input and output schemas, scopes and effect) and implemented once in `server`, whose adapters expose it. See [ADR-003](adr/0003-one-operation-registry-three-surfaces.md) and [ADR-017](adr/0017-operation-specs-in-core-handlers-in-server.md).
- **Why this primitive:** One definition, three surfaces. The MCP, RPC and HTTP contracts cannot drift apart.
- **Cost:** Worker CPU.

#### Contracts (`@hollware/core`)

Phase: v0.1.

- **What it does:** Frontmatter schema, components allowed in the body and rules between entries, evaluated on every write. See [ADR-004](adr/0004-write-time-contracts-with-a-single-definition.md).
- **Why this primitive:** It moves verification from CI to the point of writing. The agent gets the fix instruction in milliseconds.
- **Cost:** Worker CPU. Comark parses 2,000 words in about 0.5 ms in a warm isolate, and the first write in a cold one costs about 10 ms (measured in Node on 2026-10-12).

### Data

#### Content (D1)

Phase: v0.1.

- **What it does:** The single source of truth: entries, append-only revisions, users, passkeys and tokens. Read replicas in six regions. See [ADR-002](adr/0002-d1-is-the-single-source-of-truth.md).
- **Why this primitive:** One data model. Optimistic concurrency resolves simultaneous edits by people and agents, and the Sessions API guarantees reading your own writes.
- **Cost:** Free tier: 5M rows read and 100k rows written a day, 5 GB.

#### OAuth (KV)

Phase: v0.1.

- **What it does:** The OAuth clients, grants and tokens of workers-oauth-provider.
- **Why this primitive:** Global reads and expiry by TTL, which is exactly what tokens need.
- **Cost:** Free tier: 1,000 writes a day, plenty for a team with agents.

#### Cache (edge cache)

Phase: v0.2.

- **What it does:** `GET` responses of the HTTP API, close to the reader.
- **Why this primitive:** Repeated external reads do not touch D1. The publish Workflow purges what changes.
- **Cost:** No additional cost.

### Publishing

#### Publish (Workflow)

Phase: v0.2. In v0.1, `publish` runs its steps inline and answers with the outcome.

- **What it does:** Marks the revision as published, purges the cache, generates embeddings and queues events, as durable steps. It also schedules publications.
- **Why this primitive:** Each step retries on its own, and the agent follows the progress as an MCP Task.
- **Cost:** Free tier: 3,000 steps a day.

#### Events (Queues)

Phase: v0.2.

- **What it does:** Fans out `entry.published` to webhooks, IndexNow and custom subscribers, a newsletter draft for example.
- **Why this primitive:** It separates publishing from its consequences. A slow webhook blocks nothing.
- **Cost:** To verify.

#### Maintenance (Cron Triggers)

Phase: v0.2.

- **What it does:** Cleanup of expired tokens and a periodic backup to Markdown.
- **Why this primitive:** No external cron service is needed.
- **Cost:** No additional cost.

### Assets and intelligence

#### Media (R2 + Images)

Phase: v0.2.

- **What it does:** Images and files, with transformations by URL.
- **Why this primitive:** R2 charges no egress, and Images resolves the sizes without a pipeline of our own.
- **Cost:** To verify.

#### Semantic (Vectorize + Workers AI)

Phase: v0.5.

- **What it does:** Embeddings at publish time, semantic search and automatic related entries.
- **Why this primitive:** An agent that looks up context before writing writes better.
- **Cost:** Vectorize: 30M queried dimensions a month free.

#### Metrics (Analytics Engine)

Phase: v0.5.

- **What it does:** Reads per entry, exposed to the agent through `content_stats`.
- **Why this primitive:** It closes the loop: the agent can decide what to update based on what performs.
- **Cost:** To verify.

#### Own agents (Agents SDK)

Phase: v0.5.

- **What it does:** Editorial reviewer, translations and scheduled audits, in their own Worker connected by service binding. See [ADR-012](adr/0012-official-mcp-sdk-v2.md).
- **Why this primitive:** The Agents SDK is the right tool for agents with state. Living apart avoids version clashes with the MCP server.
- **Cost:** Durable Objects with SQLite: free tier.

## Flows

**Write, publish and read.** The three paths that matter, step by step, with the piece responsible for each one.

### Write

1. **MCP · Gateway.** The agent calls `update_draft` with Markdown, frontmatter and the `version` it read.
2. **Gateway · OAuth.** The Gateway validates the OAuth token: that it was issued for this instance and that it carries the `content:write` scope.
3. **core · Comark.** Comark parses the Markdown in under a millisecond for a post of 2,000 words. If it does not parse, the write is rejected.
4. **core · contracts.** The contracts run: the frontmatter schema, the components allowed in the body and the rules between entries.
5. **D1.** The write goes to D1 with optimistic concurrency. If another person or agent changed the entry, the agent receives an explicit conflict and retries on top of the new version.
6. **D1.** The revision is appended with its author: a person, an agent or a token, and which client. The agent receives the verdict with instructions to fix it.

Contract errors never block a draft. The revision is saved, and the verdict says what must be fixed before publishing.

### Publish

1. **Gateway · OAuth.** `publish` requires the `content:publish` scope and zero contracts in error. Warnings are accepted, but they have to be acknowledged and they are recorded.
2. **MCP · MRTR.** If the site asks for human approval, the server answers `input_required` (a multi round-trip request, MRTR) and the client retries with the answer.
3. **Workflow · Tasks (v0.2).** A Workflow starts, with durable steps and retries, and the agent follows its progress as an MCP Task. In v0.1, `publish` performs the steps inline and answers with the outcome.
4. **D1.** Step 1: the revision is marked as published in D1, and the read replicas receive it on their own.
5. **Cache (v0.2).** Step 2: the edge cache is purged for the entry and for the listings it affects.
6. **Workers AI · Vectorize (v0.5).** Step 3: embeddings are generated for semantic search.
7. **Queues (v0.2).** Step 4: `entry.published` events are queued for webhooks, IndexNow and custom subscribers, a newsletter draft for example.
8. **Workflow (v0.2).** A scheduled publication is the same Workflow, which sleeps until the given date.

### Read

1. **Site · RPC.** The site calls `env.HOLLWARE.getEntry(…)` over a service binding. There is no network in between and no token.
2. **D1.** The read uses the D1 Sessions API: it comes from the nearest replica and always sees what that same session wrote.
3. **server · Comark.** It returns the Markdown, the Comark document or HTML, depending on what the site asks for.
4. **Site · Comark.** The site renders the document with the Comark renderer of its framework (Vue, React, Svelte or Angular), without parsing anything.
5. **Gateway · HTTP.** Outside Cloudflare, the same read is an HTTP `GET` with a read token, or public if the content is published, with `Cache-Control` and `ETag` at the edge.

## Contracts

**Verification moves from the pipeline to the point of writing.** A contract is a rule with a name, a severity and a fix instruction. The same definition is used by MCP, the admin and the HTTP API. For an agent, a contract is not a barrier: it is immediate feedback that it can act on without human intervention.

### Configuration

The configuration below is illustrative. The exact options are settled in v0.1, together with the interfaces of `@hollware/core`: `defineConfig`, `defineCollection`, `defineComponent` and `defineContract`.

```ts
import { contracts, defineCollection, defineConfig } from '@hollware/core'
import * as z from 'zod'

export default defineConfig({
  sites: {
    acme: { locales: ['es', 'en'], defaultLocale: 'es' },
  },
  collections: {
    blog: defineCollection({
      // Zod by default; any Standard Schema with JSON Schema works
      schema: z.object({
        title: z.string(),
        description: z.string().max(160),
        tags: z.array(z.string()).min(1),
        cta: z.enum(['newsletter', 'docs', 'github']).optional(),
      }),
      // components allowed in the body, with their props
      components: {
        callout: z.object({ type: z.enum(['info', 'warning', 'tip']) }),
        youtube: z.object({ id: z.string() }),
      },
      contracts: [
        contracts.translationPair(), // the ES/EN pair publishes together
        contracts.internalLinksResolve(), // internal links must exist
        contracts.imagesHaveAlt(),
        contracts.custom({
          id: 'seo-title-length',
          severity: 'warning',
          check: ({ frontmatter }) => frontmatter.title.length <= 60,
          fix: 'Shorten the title to 60 characters or add seoTitle.',
        }),
      ],
    }),
  },
})
```

### Example verdict

This is what an agent gets back from `validate` for the entry `blog/es/edge-caching-guide`.

| Severity | Contract                                                    | Problem                                                            | Fix                                                                                       |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| error    | `schema` · `description`                                    | The description has 184 characters and the maximum is 160.         | Shorten the description to 160 characters or fewer.                                       |
| error    | `components` · `youtub`                                     | That component does not exist in this collection.                  | Use one of the allowed components: `callout` or `youtube`.                                |
| error    | `translation-pair`                                          | The `en` version of the group `edge-caching-guide` does not exist. | Create the entry in `en` with `translationGroup: "edge-caching-guide"` before publishing. |
| warning  | `seo-title-length`                                          | The title has 71 characters.                                       | Shorten the title to 60 characters or add `seoTitle`.                                     |
| ok       | `internal-links-resolve`, `images-have-alt`, `comark-parse` | These contracts passed.                                            |                                                                                           |

Each violation carries the id of its contract, a severity, a JSON Pointer to the offending field, a message and the fix instruction. Errors block `publish` but not the draft, so the agent can save work half-way. Every result is stored in the revision, which makes it possible to audit which contracts an entry passed when it was published. The same schema generates the JSON Schema that agents see over MCP and validates the forms of the admin. See [ADR-004](adr/0004-write-time-contracts-with-a-single-definition.md).

## Surfaces

**Four ways to talk to Hollware.** MCP for agents, RPC for sites on Cloudflare, HTTP with OpenAPI for everything else, and a CLI to install and maintain. The first three come from one operation registry: each operation is specified once in `core`, with its input and output schemas and its scopes, and implemented once in `server`. See [ADR-003](adr/0003-one-operation-registry-three-surfaces.md) and [ADR-017](adr/0017-operation-specs-in-core-handlers-in-server.md).

### MCP tools

| Tool                                            | What it does                                                                                                   | Scope             | Phase     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------- | --------- |
| `describe_site`                                 | Collections, contracts as JSON Schema, allowed components and the style guide. The first thing an agent reads. | `content:read`    | 0.1       |
| `list_entries`, `get_entry`, `get_translations` | Reads with filters by collection, locale, tag and status, and the translations of a group.                     | `content:read`    | 0.1       |
| `create_draft`, `update_draft`                  | Writes Markdown. Returns the verdict of the contracts, or a conflict if the entry changed.                     | `content:write`   | 0.1       |
| `validate`                                      | Runs the contracts without saving.                                                                             | `content:read`    | 0.1       |
| `publish`, `unpublish`                          | Publishes if there are no errors. From v0.2 it starts the Workflow, which the agent follows as a Task.         | `content:publish` | 0.1       |
| `schedule`                                      | Schedules the publication for a date.                                                                          | `content:publish` | 0.2       |
| `list_revisions`, `restore`                     | History with author and a Markdown diff.                                                                       | `content:write`   | 0.2       |
| `upload_asset`                                  | Uploads to R2 and returns the transformable URL.                                                               | `content:write`   | 0.2       |
| `search`                                        | Full-text search and, from v0.5, semantic search.                                                              | `content:read`    | 0.2 / 0.5 |
| `content_stats`                                 | Metrics per entry, so the agent can decide what to improve.                                                    | `content:read`    | 0.5       |

The scopes are `content:read`, `content:write`, `content:publish` and `schema:admin`. The list of tools is the same for every client, and the scope is checked when a tool is called. v0.2 also adds a trash for entries, with the operations `delete_entry` and `restore_entry`.

### RPC, HTTP and CLI

RPC is the main read path for sites in the same Cloudflare account. The site declares a service binding to the Hollware Worker.

```jsonc
// wrangler.jsonc of the site
{
  "services": [{ "binding": "HOLLWARE", "service": "hollware", "entrypoint": "Hollware" }],
}
```

The Hollware Worker exposes the registry through a named entrypoint.

```ts
import { WorkerEntrypoint } from 'cloudflare:workers'

// Hollware's Worker: the RPC adapter of the registry
export class Hollware extends WorkerEntrypoint<Env> {
  getEntry(site: string, collection: string, slug: string, locale: string) {
    // reads through the D1 Sessions API
  }
  listEntries(
    site: string,
    collection: string,
    options: { locale?: string; tag?: string; limit?: number; cursor?: string },
  ) {
    // keyset pagination
  }
  getTranslations(site: string, translationGroup: string) {
    // the entries of a translation group
  }
  describeSite(site: string) {
    // collections, contracts and allowed components
  }
  // v0.2
  search(site: string, query: string, options: { locale?: string; semantic?: boolean }) {
    // full-text search
  }
}
```

In the site, whether it is Nuxt, Astro or anything else running on Cloudflare:

```ts
const post = await env.HOLLWARE.getEntry('acme', 'blog', 'edge-caching-guide', 'es')
// post.document renders with <Comark :document="post.document" />
```

HTTP serves everything else, with an OpenAPI 3.1 document generated from the registry.

```http
GET /v1/sites/acme/blog?locale=es&tag=agents
GET /v1/sites/acme/blog/edge-caching-guide?locale=en
GET /openapi.json
```

The CLI installs and maintains an instance.

```bash
hollware init              # single-use link for the owner's passkey
hollware migrate           # applies the D1 migrations of the installed version
hollware import ./content/blog --site acme
hollware export --to markdown   # v0.2
hollware reparse --all     # v0.2, after upgrading Comark
```

## Data model

**D1 as the single source of truth.** One model for writing and reading. Revisions are never edited: they are only appended. Concurrency is resolved with a `version` column. From v0.1 every table carries `site_id`, even with a single site. The schema is defined in TypeScript with Drizzle, and its migrations travel inside `@hollware/server`. See [ADR-002](adr/0002-d1-is-the-single-source-of-truth.md) and [ADR-006](adr/0006-one-deployment-per-account-several-sites-inside.md).

### Content

```sql
CREATE TABLE entries (
  id                TEXT PRIMARY KEY,   -- ULID
  site_id           TEXT NOT NULL,
  collection        TEXT NOT NULL,
  locale            TEXT NOT NULL,
  slug              TEXT NOT NULL,
  translation_group TEXT,
  status            TEXT NOT NULL,      -- draft | scheduled | published
  version           INTEGER NOT NULL,   -- optimistic concurrency
  head_rev          INTEGER NOT NULL,
  published_rev     INTEGER,
  scheduled_at      TEXT,
  updated_at        TEXT NOT NULL,
  UNIQUE (site_id, collection, locale, slug)
);
CREATE TABLE revisions (              -- rows are only ever appended
  entry_id       TEXT NOT NULL,
  rev            INTEGER NOT NULL,
  frontmatter    TEXT NOT NULL,       -- validated JSON
  markdown       TEXT NOT NULL,       -- source of truth
  document       TEXT NOT NULL,       -- Comark, derived
  comark_version TEXT NOT NULL,
  verdict        TEXT NOT NULL,       -- result of the contracts
  word_count     INTEGER,
  actor_kind     TEXT NOT NULL,       -- human | agent | token
  actor_id       TEXT NOT NULL,       -- user or OAuth client_id
  actor_meta     TEXT,                -- MCP client, and model if it declares one
  created_at     TEXT NOT NULL,
  PRIMARY KEY (entry_id, rev)
);
CREATE INDEX entries_list
  ON entries (site_id, collection, locale, status, updated_at DESC);
CREATE TABLE entry_tags (entry_id TEXT, tag TEXT);
```

### Access and assets

```sql
CREATE TABLE users (
  id   TEXT PRIMARY KEY,
  name TEXT,
  role TEXT NOT NULL       -- owner | editor | reviewer
);
CREATE TABLE passkeys (
  id         TEXT PRIMARY KEY,  -- credential id (WebAuthn)
  user_id    TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter    INTEGER NOT NULL,
  transports TEXT
);
CREATE TABLE tokens (                -- personal tokens
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  hash       TEXT NOT NULL,      -- never the token in clear text
  scopes     TEXT NOT NULL,      -- content:read|write|publish, schema:admin
  expires_at TEXT,
  revoked_at TEXT
);
CREATE TABLE assets (id TEXT, site_id TEXT, r2_key TEXT,
  mime TEXT, width INTEGER, height INTEGER, alt TEXT);
CREATE TABLE subscriptions (id TEXT, site_id TEXT,
  event TEXT, url TEXT, secret TEXT);

-- KV (OAUTH_KV): OAuth clients, grants and tokens,
-- managed by workers-oauth-provider
```

### Refinements in v0.1

The SQL above is the sketch from the design phase. The v0.1 implementation refines it, and the implementation plan, `PLAN.md`, tracks the details while v0.1 is built.

- **Shared column helpers.** `columns.ts` defines `id(prefix)`, which produces prefixed ULIDs such as `ent_`, `rev_`, `usr_` and `tok_`, and the `created_at` and `updated_at` columns in UTC. Every table uses them, and only repository functions write.
- **Site isolation in the schema.** `site_id` is on every table, child tables included. Each table has `UNIQUE(id, site_id)` and the foreign keys are composite, and CHECK constraints keep `status`, `published_rev` and `scheduled_at` coherent and turn enums into `CHECK ... IN`. A guard test over the Drizzle schema fails when a table lacks `site_id` or the timestamps.
- **Entries.** They gain `published_at` and `published_sort_key`, a uniqueness rule on `(site_id, collection, translation_group, locale)` and a partial index for listing what is published.
- **Append-only revisions.** `revisions.markdown` holds the whole file, frontmatter included, so an export is byte-identical. Triggers block `DELETE` and any update of the immutable columns, while the derived columns (`document`, `comark_version`, `pipeline_version` and `word_count`) stay updatable by `hollware reparse`.
- **Optimistic writes.** A write is one `db.batch`: an `INSERT INTO revisions … SELECT … WHERE version = ?` and an `UPDATE entries … WHERE version = ? RETURNING version`. An empty `RETURNING` is a conflict. A row over 1.9 MB is rejected with a `size-limit` violation.
- **Access tables.** `users`, `passkeys`, `tokens` (hash, scopes, expiry, revocation and last use), `setup_links` (single use, through an atomic `UPDATE … RETURNING`) and `auth_challenges`.

## Repository and stack

**One monorepo, twelve decisions.** Hollware ships as a library: the user has a Worker of a few lines, and upgrades by bumping a version and running the migrations. `core` does not depend on Cloudflare: its source type-checks against the web platform only, and its tests run in Node and inside workerd ([ADR-018](adr/0018-core-type-checks-against-the-web-platform.md)). The versions are those published as of 11 October 2026. Each stage pins the ones it uses in the pnpm catalog when it starts.

| Package            | What it is                                                                                                                                   | Phase |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `@hollware/core`   | Contracts, operation specs, schemas and the Markdown pipeline with Comark. It does not depend on Cloudflare.                                 | v0.1  |
| `@hollware/server` | The Worker: operation handlers and their MCP, RPC and HTTP adapters, Hono, OAuth, D1 with Drizzle and Workflows. It includes the migrations. | v0.1  |
| `hollware`         | The CLI: init, migrate, token and import. Export and reparse arrive in v0.2.                                                                 | v0.1  |
| `apps/playground`  | An instance of our own, to exercise the project in real use with `vp dev`.                                                                   | v0.1  |
| `@hollware/client` | The same typed interface over a service binding or over HTTP.                                                                                | v0.2  |
| `@hollware/admin`  | Vue 3.5 and Nuxt UI 4, published compiled and served as static files of the Worker.                                                          | v0.3  |
| `create-hollware`  | `npm create hollware` copies the thin project from `templates/starter`.                                                                      | v0.4  |
| `apps/docs`        | Docus 5 in English, at hollware.com, with its own `llms.txt` and MCP.                                                                        | v0.4  |
| `examples/`        | Sites that consume Hollware (Nuxt, Astro and others). They are not published.                                                                | v0.1+ |

Later stages add `@hollware/nuxt` (v0.4), `@hollware/agents` (v0.5), and `@hollware/astro` and `@hollware/next` (v1.0).

| #   | Area                   | Choice                                                                                                         | Version                                        | Why                                                                                                                   |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 01  | Toolchain and monorepo | Vite+ with pnpm 12, Node 24 LTS                                                                                | vite-plus 1.1, pnpm 12.11                      | Vite, Vitest 5, Oxlint, Oxfmt, tsdown and cached tasks in one tool. pnpm for its minimum-age and provenance policies. |
| 02  | Cloudflare             | Vite plugin 1.x, `wrangler.jsonc` and `wrangler types`; tests with `@cloudflare/vitest-plugin`                 | plugin 1.63, wrangler 4.149, vitest-plugin 1.4 | Stable today, and the same pipeline the `cf` CLI uses, which we migrate to when it leaves beta.                       |
| 03  | Persistence            | D1 with read replicas and Drizzle                                                                              | drizzle-orm 0.45                               | One data model and generated migrations. Without the relational API, to move to v1 easily.                            |
| 04  | Schemas                | Zod 4, contracts open to Standard Schema                                                                       | zod 4.6                                        | The MCP SDK already ships it, and it exports JSON Schema natively.                                                    |
| 05  | Markdown               | Comark                                                                                                         | comark 0.7                                     | About 0.5 ms for 2,000 words once warm, components compatible with MDC and renderers for four frameworks.             |
| 06  | API                    | Hono 5, native RPC and OpenAPI 3.1 from the registry                                                           | hono 5.0 RC                                    | One definition per operation, three surfaces. Hono 5 uses the same toolchain.                                         |
| 07  | MCP                    | Official SDK v2, stateless                                                                                     | @modelcontextprotocol/server 2.3               | Up to date with the 2026-07-28 specification: Tasks, scopes per tool and validation without `eval`.                   |
| 08  | Access                 | Cloudflare OAuth, passkeys and personal tokens; Access optional                                                | workers-oauth-provider 1.2, simplewebauthn 14  | About 115 KB gzipped in a minified Worker, no Node APIs, and no external setup to start.                              |
| 09  | Admin                  | Vue 3.5 + Nuxt UI 4 (without Nuxt) + Vue Router 5; editor with CodeMirror 6                                    | @nuxt/ui 4.11                                  | Dashboard, tables, forms with Standard Schema and chat, ready to use.                                                 |
| 10  | Releases               | Changesets with a single version, a `release` branch and direct publishing over OIDC; previews with pkg.pr.new | @changesets/cli 3.0                            | Nothing reaches npm until the maintainer approves the `npm` environment, and `release` only takes commits of `main`.  |
| 11  | Documentation          | Docus 5, in English                                                                                            | docus 5.14                                     | `llms.txt`, MCP and every page as Markdown, out of the box.                                                           |
| 12  | CI and governance      | GitHub Actions with `setup-vp`; `AGENTS.md` only; everything in English                                        | setup-vp 1.21                                  | MCP conformance and a Worker size budget on every pull request. No dependency bots for now.                           |

## Decisions

**Decision records (ADR).** Every structural decision is recorded as an ADR in [`docs/adr/`](adr/README.md), from phase 0. The accepted ones come out of the research of 11 October 2026. The proposed ones carry over from the original design and are confirmed when the code that depends on them starts. Decisions change only through a new or superseding ADR.

| ADR                                                                           | Title                                                                                                       | Status                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------- |
| [ADR-001](adr/0001-markdown-is-the-source-of-truth.md)                        | Markdown is the source of truth; the Comark document is derived                                             | Accepted              |
| [ADR-002](adr/0002-d1-is-the-single-source-of-truth.md)                       | D1 is the single source of truth                                                                            | Accepted              |
| [ADR-003](adr/0003-one-operation-registry-three-surfaces.md)                  | One operation registry, three surfaces (RPC, HTTP + OpenAPI 3.1, MCP)                                       | Accepted              |
| [ADR-004](adr/0004-write-time-contracts-with-a-single-definition.md)          | Write-time contracts with a single definition                                                               | Accepted              |
| [ADR-005](adr/0005-cloudflare-oauth-provider-passkeys-and-personal-tokens.md) | Cloudflare OAuth provider, passkeys and personal tokens                                                     | Accepted              |
| [ADR-006](adr/0006-one-deployment-per-account-several-sites-inside.md)        | One deployment per account, several sites inside                                                            | Proposed              |
| [ADR-007](adr/0007-admin-in-vue-with-nuxt-ui-without-nuxt.md)                 | Admin in Vue 3.5 with Nuxt UI 4, without Nuxt                                                               | Accepted              |
| [ADR-008](adr/0008-independent-project-mit-own-github-organization.md)        | Independent project, MIT, own GitHub organization                                                           | Accepted              |
| [ADR-009](adr/0009-cloudflare-only-until-v1.md)                               | Cloudflare only until v1                                                                                    | Proposed              |
| [ADR-010](adr/0010-vite-plus-with-pnpm-distributed-as-a-library.md)           | Vite+ with pnpm 12, distributed as a library (thin user project)                                            | Accepted              |
| [ADR-011](adr/0011-cloudflare-vite-plugin-today-cf-cli-later.md)              | Cloudflare's Vite plugin today, the `cf` CLI later                                                          | Accepted              |
| [ADR-012](adr/0012-official-mcp-sdk-v2.md)                                    | Official MCP SDK v2; the Agents SDK only for Hollware's own agents                                          | Accepted              |
| [ADR-013](adr/0013-releases-with-changesets.md)                               | Releases with Changesets, one version for all packages, OIDC and staged publishing with maintainer approval | Superseded by ADR-015 |
| [ADR-014](adr/0014-release-pipeline.md)                                       | Release pipeline: Changesets versions, `npm stage publish` publishes                                        | Superseded by ADR-015 |
| [ADR-015](adr/0015-release-branch-and-direct-publishing.md)                   | A `release` branch for production, and direct publishing behind the `npm` environment approval              | Accepted              |
| [ADR-016](adr/0016-workspace-packages-resolve-to-source.md)                   | Workspace packages resolve to their source; `dist` only in the published manifest                           | Accepted              |
| [ADR-017](adr/0017-operation-specs-in-core-handlers-in-server.md)             | Operation specs live in `core`; handlers and adapters in `server`                                           | Accepted              |
| [ADR-018](adr/0018-core-type-checks-against-the-web-platform.md)              | `core` type-checks against the web platform and runs its tests in Node and workerd                          | Accepted              |
| [ADR-019](adr/0019-personal-tokens-in-v0-1-oauth-with-the-admin.md)           | Personal tokens in v0.1; OAuth and passkeys arrive with the admin                                           | Accepted              |
| [ADR-020](adr/0020-content-safety-is-a-contract.md)                           | Content safety is a contract: raw HTML, unknown components and unsafe attributes are errors at write time   | Accepted              |

## Roadmap

**Stages with verifiable exits.** Every stage ends with an exit criterion that can be checked. The dates assume part-time work with agents, and they are an estimate, not a commitment.

### Validation

Hollware is validated with consumers that belong to the project, and every test uses synthetic fixtures. Everything runs locally, with Miniflare and `wrangler dev`, until v0.2, which is the first stage that deploys.

| Stage | Validated with                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1  | An example site in `examples/`: a minimal Worker that reads over RPC what an agent published over MCP.                                      |
| v0.2  | A demo deployment on subdomains of hollware.com. By default, `demo.hollware.com` for the site and `cms.demo.hollware.com` for the instance. |
| v0.4  | The hollware.com documentation, written in Hollware and running as a second site on the same deployment.                                    |
| v1.0  | Three production sites: hollware.com, the demo and at least one external site.                                                              |

### F0: Foundations

Oct 2026 · 1–2 weeks.

**Goal.** A public repository that explains the thesis, with the stack running before the first feature.

**Scope**

- The repository `hollware/hollware`, created with `vp create vite:monorepo`, with pnpm 12 and Node 24
- The structure: `packages`, `templates`, `apps` and `examples`
- `AGENTS.md` at the root and in each package, with invariants bound to tests
- The MIT license, README, CONTRIBUTING, code of conduct and SECURITY
- ADR-001 to ADR-015 in `docs/adr/`, and this document as `docs/design.md`
- CI: `ci.yml` and `security.yml`, with actions pinned by SHA
- Changesets with a single version, a `release` branch that only takes commits of `main`, placeholders on npm for the six package names and trusted publishing
- A walking skeleton of the stack on Cloudflare: a Worker served by `vp dev`, a named `WorkerEntrypoint` called over a service binding, and D1 with migrations shipped from a package
- A verification surface: convention tests and meta-tests that fail when a claim stops being true
- The release `0.0.1`, published through the pipeline with provenance

**Exit criterion.** A public repository with a README that states the thesis, the ADRs, green CI and the six names reserved on npm, with `0.0.1` published through the release pipeline.

### v0.1: Core

Oct–Nov 2026 · 3 weeks.

**Goal.** An agent writes and publishes over MCP, with the contracts validated at write time, and an example site reads what was published over RPC.

**Scope**

- `hollware.config.ts` with sites, collections, contracts and allowed components
- The operation registry: the specs in `core`, the handlers and the MCP and RPC adapters in `server`
- D1 with Drizzle: entries, revisions and optimistic concurrency
- Comark on write, and the contracts: schema, components, translation pair, internal links and custom rules
- MCP with SDK v2: `describe_site`, `list_entries`, `get_entry`, `get_translations`, `create_draft`, `update_draft`, `validate`, `publish` and `unpublish`
- Personal tokens; OAuth and passkeys arrive with the admin in v0.3 ([ADR-019](adr/0019-personal-tokens-in-v0-1-oauth-with-the-admin.md))
- Content safety as contracts: raw HTML, unknown components and unsafe attributes are errors at write time ([ADR-020](adr/0020-content-safety-is-a-contract.md))
- CLI: `hollware init`, `migrate`, `token` and `import`
- The MCP conformance suite and a size budget in CI
- An example site in `examples/` that reads published entries over RPC

**Exit criterion.** The v0.1 acceptance suite is green: an agent drafts, fixes, publishes and handles a version conflict over MCP, and the example site serves the published HTML over RPC while drafts return 404.

### v0.2: Publishing

Nov–Dec 2026 · 3 weeks.

**Goal.** Publishing is a durable, observable process, and on the demo deployment a post goes live in under 60 seconds with no CI.

**Scope**

- A publish Workflow followed as an MCP Task, and scheduled publishing
- Events: an outbox in D1 and a Queue, with HMAC-signed webhooks, IndexNow, custom subscribers and a dead-letter queue
- Revisions with a Markdown diff and restore, and a trash with `delete_entry` and `restore_entry`
- Media in R2 with Images
- Full-text search
- An HTTP API with OpenAPI 3.1, ETag and an edge cache that is purged on publish
- `@hollware/client`, with the same interface over a binding or over HTTP
- Export to Markdown as a backup, `reparse` and `reindex`, and scheduled backups
- An `audit_log` of writes and denials
- Optional code highlighting at write time
- The demo deployment

**Exit criterion.** On the demo, a post published over MCP is live in under 60 seconds with no CI, and its `entry.published` event reaches IndexNow and a webhook that a test receiver verifies.

### v0.3: Admin

Dec 2026 – Jan 2027 · 3 weeks.

**Goal.** Publish and approve a complete post without Claude Code or git.

**Scope**

- Vue 3.5 with Nuxt UI 4, compiled inside `@hollware/admin`
- An entry list with the status and the verdict of the contracts
- A Markdown editor with CodeMirror 6 and a Comark preview
- Forms generated from the contracts
- A revision diff with the author, and an approval queue
- OAuth with the provider's role-based API, passkeys, setup links, invitations, tokens and the OAuth consent screen ([ADR-019](adr/0019-personal-tokens-in-v0-1-oauth-with-the-admin.md))

**Exit criterion.** A new post written by an agent is reviewed and approved from the admin, and axe reports no serious or critical violations.

### v0.4: Distribution

Jan–Feb 2027 · 4 weeks.

**Goal.** Anyone can install Hollware, and a second site runs on the same deployment.

**Scope**

- `create-hollware` and `templates/starter`: installation with one command, plus `hollware deploy` and `hollware doctor`
- Documentation with Docus at hollware.com, in English
- The documentation as a second site: written in Hollware and exported at build time
- Read tokens for external HTTP consumers, and isolation between sites
- An optional Nuxt integration, `@hollware/nuxt`

**Exit criterion.** A sub-agent that can only read the documentation, and an external person, both install Hollware from the documentation alone.

### v0.5: Intelligence

Feb–Mar 2027 · 3 weeks.

**Goal.** The agent uses the existing content and the metrics to write better.

**Scope**

- Embeddings at publish time with Workers AI and Vectorize
- Semantic `search` over MCP, RPC and HTTP
- Automatic related entries
- Analytics Engine and the `content_stats` tool
- Own agents with the Agents SDK, in their own Worker: an editorial reviewer, translation and audits. They never get `content:publish`.

**Exit criterion.** An agent looks up context, proposes what to update based on the metrics and publishes it through the contracts.

### v1.0: Stable

Q2 2027.

**Goal.** A frozen API with semantic versioning and three sites in production.

**Scope**

- A stable public API (RPC, HTTP and MCP), with a stability policy and guards that fail on breaking changes
- Migration to the `cf` CLI and to Drizzle v1, if they have shipped by then
- Importers and migration guides from Nuxt Content, EmDash and plain Markdown
- A security review of the Gateway and of the OAuth flow
- Astro and Next integrations

**Exit criterion.** Three or more sites in production: hollware.com, the demo and at least one external site.

### Vision: after 1.0

2027+.

**Goal.** The default content backend for teams that work with agents.

**Scope**

- Live editing between people and agents, with Durable Objects for presence
- Policies per agent: what each one can publish without approval, and with which quotas
- Full provenance of every change: which agent, which client and who approved
- Content as a read-only API for third-party agents: a public MCP endpoint and an `llms.txt` per site
- Translations of the documentation, and importers from WordPress and other CMSs

**Direction.** That the question "where do your agents write?" has an obvious answer.

### Out of scope: migrating sergioazocar.com

The author's own site, sergioazocar.com, is not a validation target of this roadmap, and it is not migrated as part of it. Every stage is validated with consumers that belong to Hollware, and every test uses synthetic fixtures. Migrating sergioazocar.com happens after v1.0 and has its own plan, kept in the repository of that site.

## Costs

**What it costs to run two sites.** For a couple of sites, everything should fit in the free tiers, Workflows included. Workers Paid ($5 a month) is only turned on if a site goes past 100,000 requests a day or needs more CPU per request. The verified figures come from Cloudflare's official documentation, checked in October 2026.

| Primitive                              | Use in Hollware                         | Free tier                                                                                         | Status     |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| Workers                                | Gateway, MCP, RPC and HTTP              | 100,000 requests/day · 10 ms of CPU per request · 64 MiB uncompressed. Paid: $5/month.            | verified   |
| D1                                     | Source of truth                         | 5M rows read/day · 100k rows written/day · 5 GB · 500 MB per database · 50 queries per invocation | verified   |
| KV                                     | OAuth state                             | 100,000 reads/day · 1,000 writes/day · 1 GB                                                       | verified   |
| Workflows                              | Publishing, scheduling and MCP Tasks    | 3,000 steps/day · 10 ms of CPU · state kept for 3 days · 1 GB-month                               | verified   |
| Durable Objects (SQLite)               | Coordination only, if it is ever needed | 5M rows read/day · 100k rows written/day · 5 GB                                                   | verified   |
| Vectorize                              | Semantic search (v0.5)                  | 30M queried dimensions/month · 5M stored dimensions                                               | verified   |
| R2 · Images                            | Media and transformations               | R2 has no egress cost.                                                                            | unverified |
| Queues · Workers AI · Analytics Engine | Events, embeddings and metrics          | To review when v0.2 and v0.5 arrive.                                                              | unverified |

## Risks and open questions

**What can go wrong.**

- **The project eats the author's time.** Building a CMS competes with producing videos and posts. Mitigation: every stage ends with a pause and a publishable milestone, and the process of building is itself the content.
- **Tools in transition.** Hono 5 is a release candidate, Drizzle v1 is a release candidate, the `cf` CLI is in beta and the MCP SDK moves every week. Mitigation: exact versions in the catalog, thin adapters with the version isolated in one file, and a review of the stack at the start of every stage.
- **10 ms of CPU on the Free plan.** A heavy bundle or a slow parse breaks requests. Mitigation: Comark measures about 2.4 ms to parse and render 10,000 words once warm, but a cold isolate pays about 10 ms for the first write of 2,000 words (measured in Node on 2026-10-12). A size budget runs in CI, builds are minified, reads render stored documents without the parser, heavy work goes to Workflows or to the queue, and the demo of v0.2 measures it on Cloudflare.
- **Comark is pre-1.0.** Its API and the shape of its document can change. Mitigation: `comark_version` on every revision and `hollware reparse`, which is possible because Markdown is the source of truth.
- **Publishing rests on one account.** A release needs the maintainer's approval of the `npm` environment, and no second factor on npm. That approval is a human act only while the credentials the agents use cannot review deployments (ADR-015). Mitigation:
  - the organization enforces 2FA;
  - only `release` can deploy to the environment;
  - `release` moves only by fast-forward, and `promotion-check` stops a commit that is not on `main`;
  - the trusted publisher is bound to one workflow and one environment;
  - every version carries provenance, and the finalize step verifies the attestations.

  The direct path first ran for 0.0.2. Publishing under "require 2FA and disallow tokens" is first exercised by 0.1.0.

- **SimpleWebAuthn on Workers.** SimpleWebAuthn 14 does not list Workers as an official platform. Mitigation: the v0.1 spike ran a full ceremony with a software authenticator on a built Worker without Node.js compatibility (2026-10-12), so `nodejs_compat` is not needed. Passkeys ship in v0.3.
- **The brand.** A 2021 trademark application for "HOLOWARE" exists, for product visualization software. It is spelled differently and belongs to a different field, but its status at the USPTO has to be checked before v1.0.
- **EmDash ships a real headless mode.** That is not a risk, it is information. If it covers the thesis, Hollware is evaluated against it and archived without drama if it loses.

### Success metrics for v1.0

| Target | What it means                                                                   |
| ------ | ------------------------------------------------------------------------------- |
| < 60 s | From "the agent finishes the post" to "it is published", with no CI in between. |
| 0      | Contracts in error in production. Everything published passed its contracts.    |
| ≤ $5   | Monthly cost with two sites in production.                                      |
| 3+     | Sites in production: hollware.com, the demo and at least one external site.     |
