# ADR-040: Hollware reads the site's analytics, it does not collect them

Status: Accepted (2026-10-21)

## Context

ADR-031 made Hollware count page views itself: a site sends a beacon to `POST /events`
(`@hollware/nuxt` does it with its `beacon` option), the Worker writes each view to Analytics
Engine through an `ANALYTICS` binding, and `content_stats` reads them back from the SQL API with a
token of the deployment (`HOLLWARE_ANALYTICS_*`).

That contradicts the first principle, headless always. Hollware does not render the site, so it
should not instrument it either: every site has to add an integration to be counted (a plugin of
its own when it does not use `@hollware/nuxt`), the views duplicate what the site already measures
with less (no referrers, no visitors, no conversions), and the count starts empty however long the
site has existed. Wiring sergioazocar.com to the beacon showed all of it: the site already measures
every page in PostHog, with history.

What makes the feature worth having is not the counting. It is `content_stats`: the most read paths
of a site, each matched to the published entry the routes of the site put there, which an agent
uses to pick what to update (the `refresh_content` prompt, the auditor of `@hollware/agents`, the
"Most read" panel of the admin).

Spikes on 2026-10-21, with real accounts:

- **Cloudflare Web Analytics.** A user API token with Account Analytics Read reads the GraphQL API
  (`rumPageloadEventsAdaptiveGroups`): visits by `requestHost` and `requestPath`, sampled (the
  counts come in steps of ten), for every site of the account, so a site filters by its hosts.
  Such a token cannot list its own account (`/accounts` answers none, GraphQL refuses an account
  it is not named), so the connection names the account.
- **PostHog.** A personal API key with Query read, scoped to one project, runs HogQL on
  `/api/projects/<id>/query/`: exact page views and visitors by `$host` and `$pathname`. A
  project-scoped key cannot list projects (403) but finds its own at `/api/projects/@current/`, and
  only the host of its region (US or EU) accepts it.
- **Plausible** (Stats API v2) and **GA4** (Data API, a service account) answer the same question
  according to their documentation; a live check waits for an account.

## Decision

- **Hollware never collects page views.** `POST /events`, the `ANALYTICS` binding, the
  `HOLLWARE_ANALYTICS_*` variables and the `beacon` option of `@hollware/nuxt` are removed.
- **A site connects to the analytics it already has**: Cloudflare Web Analytics, PostHog,
  Plausible or GA4. A connection is a provider, its settings (hosts, account, project, region,
  site id, property) and one read-only credential.
- **The connection lives in its own table**, `site_analytics`, one row per site, not in the site's
  definition: `update_site` replaces the whole definition and `get_structure` is readable with
  `content:read`. The credential is sealed with `HOLLWARE_SECRET`, bound to the site and the name
  `analytics` (as webhook secrets are, ADR-033), and never comes back in an answer, a log, a cache
  key or a backup.
- **Three operations, all `schema:admin`**: `get_analytics` (the connection without its
  credential), `connect_analytics` (tests the source on the last days before it saves anything, and
  answers `connected` with what it saw, `refused` with the permission to add, `unreachable` or
  `unavailable` without `HOLLWARE_SECRET`) and `disconnect_analytics`. The admin (Site → Analytics)
  and the CLI (`hollware analytics`) are the ways meant for people, so a credential does not pass
  through an agent's context; the tools exist for parity.
- **`content_stats` keeps its contract**, and gains an optional `source`: it reads the site's
  connection, normalizes what the provider answers (the site's hosts only, no query or fragment,
  `/a` and `/a/` as one path, no `/cdn-cgi/` paths) and matches each path to its entry as before.
  With no connection it answers `unavailable`, and its fix says how to connect one. Answers are kept
  ten minutes in the Worker's cache under a key that names the provider and the connection's last
  change, never the credential.
- **Each provider is an adapter** in `packages/server/src/analytics/`, behind the `AnalyticsReader`
  port, so handlers stay free of network code; every request has a timeout.

## Consequences

- Removing the beacon breaks the public API of 1.0 (exports of `@hollware/server`, the `beacon`
  option of `@hollware/nuxt`) before 1.0 is final. It ships with a major changeset, and
  `scripts/api-check.ts` lets a break through when a changeset made since the last release asks for
  a major version, as ADR-036 says.
- A site with no analytics gets no counts from Hollware. Agents work without that signal, as they
  did on a deployment without Analytics Engine.
- Cloudflare's counts are sampled and PostHog's are exact. Both are good enough to rank paths, which
  is what `content_stats` is for; the docs say which is which.
- Hollware now calls third parties chosen by the site's owner: `content_stats` and
  `connect_analytics` are open-world tools, and the threat model covers the credential and the
  hosts it is sent to (`global_fetch_strictly_public` keeps them public).
- Nothing about readers is stored by Hollware any more, so ADR-031's guarantees on personal data
  move to the provider the owner chose.

## Alternatives considered

- **Keep the beacon as a fallback for sites with nothing.** Hollware would still be in the business
  of measuring a frontend it does not own, with every cost listed above. A site that wants counts
  can add any provider, and the free tiers of Cloudflare Web Analytics and PostHog cost nothing.
- **Sign in with each provider over OAuth.** Each deployment has its own domain, and OAuth needs an
  app registered with fixed return URLs: every owner would register one, or Hollware would run a
  central broker holding everyone's tokens, which goes against running everything on the owner's
  account. A read-only key, tested when it is pasted, is one minute of work.
- **Keep the deprecated exports and ignore the `beacon` option until 2.0.** Nothing would break, but
  1.0 would ship dead code that 2.0 removes anyway; a release candidate is the moment to remove it.
