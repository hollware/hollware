# ADR-031: Page views without personal data

Status: Accepted (2026-10-15)

## Context

v0.5 lets an agent see what readers read, so that it updates what matters. The sites that read Hollware know their page views; Hollware does not. The maintainer chose to count them with a beacon of Hollware's own, on hollware.com and the demo, with no cookie, no IP and no user agent: the path, the site and the country.

## Decision

- **A beacon, `POST /events`**, outside `/v1`, with no token: a page sends `{ "site": "<key>", "path": "/<path>" }`. It is counted only when the page's origin is one of the site's (its `url` or its `cors.origins`): the guard lets `POST /events` through from any origin, and the route checks the origin against the site the beacon names, the only check that knows which site that is. The path loses its query and fragment. It answers 204 whether or not anything was counted.
- **Analytics Engine keeps the views**, through an optional `ANALYTICS` binding: one data point per view, indexed by the site, with the path and the country that Cloudflare gives the request (`XX` when none). No cookie, IP or user agent is read or written. A Worker without the binding counts nothing.
- **`content_stats`** (MCP, `content:read`) reads the most read paths of the site over 1 to 90 days from the SQL API of Analytics Engine, `SUM(_sample_interval)` so that sampling is accounted for, with an account id and a secret API token with Account Analytics Read (`HOLLWARE_ANALYTICS_ACCOUNT_ID`, `HOLLWARE_ANALYTICS_TOKEN`). The SQL API takes no parameters, so every value in the query is checked first. Answers are kept ten minutes in the Worker's cache. Each path is matched to the published entry that the routes of the site put there, at query time, so the page sends no id. Without the account or the token it answers `unavailable`.
- **`@hollware/nuxt` sends the beacon** when its `beacon` option names the Hollware: on each page the reader sees, with `fetch`, `credentials: 'omit'` and `keepalive`.
- **An MCP prompt, `refresh_content`**, walks an agent through the loop: `content_stats`, `get_entry` with related entries, `search`, `update_draft`, `publish`.
- **RPC stays read-only.** A site's server that wants to count views posts to `/events` with the site's origin.

## Consequences

- Anyone can send a view with a forged `Origin`; the count is a guide for an agent, not an audit. Views carry nothing that identifies a reader, so a forged one harms no one's privacy.
- A Worker with the binding and no API token counts views but cannot read them; `content_stats` says so.
- The counts are minutes behind the views, and ten more minutes old at most.

## Alternatives considered

- The Web Analytics of Cloudflare. Rejected: its data is per zone, behind another API, and not per entry.
- Counting in D1. Rejected: a write per page view would spend the free plan's writes on reading, not writing.
- Taking the entry's id from the page. Rejected: the page would send what the server can work out from the path.
