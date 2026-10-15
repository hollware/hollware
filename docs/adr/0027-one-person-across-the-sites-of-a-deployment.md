# ADR-027: One person across the sites of a deployment

Status: Accepted (2026-10-15)

## Context

Until v0.3 a deployment served exactly one site, and passkeys, sessions and sign-in challenges each carried the site. v0.4 runs a second site, the documentation, in the same deployment as the demo blog, so a deployment serves every site of its config. That leaves one question: is a person one per site, with a passkey for each, or one per deployment? The maintainer chose one person for the whole deployment (2026-10-15).

## Decision

- **A deployment serves every site of its config**, at least one. A personal token, an OAuth grant and an RPC call each name one site, and act on it alone: the gateway takes the site of the principal for `/mcp`, `/v1` and `/v1/ops/{name}`, and the RPC binding looks up the site the call names. A token or a grant of a site the deployment does not serve is refused (`other_site`); an RPC call for one is `invalid_input` that lists the sites it serves.
- **A person has one passkey and one session for the deployment.** `passkeys`, `sessions` and `auth_challenges` have no `site_id` (migration `0006_people_across_sites.sql`; `TABLES_WITHOUT_SITE` of `tests/conventions/schema.test.ts` names them, with the reason). The role stays per site, in `members`.
- **A grant is for one site.** `/authorize` takes the site from `?site=` when the person is a member of it, from their only site otherwise, and asks on the consent page when they are in several, offering the scopes any of those roles allow. The POST checks the membership and grants no more than the role of the chosen site allows. The admin, which gets no consent page, names its site, or gets the first one.
- **The admin switches sites by signing in again.** `GET /v1/admin/me` answers the person, the site of the token, its scopes and the sites of the deployment the person is a member of, for every role. Switching keeps the site in session storage, forgets the tokens and goes through `/authorize?site=`, which the session answers without a ceremony.
- **`hollware init --site <key>`** on a database that has an owner makes that owner the owner of the new site, with a token of that site and no setup link. A site that has an owner is refused.
- The cron trigger runs the schedules and the outbox of each site in turn, and one that fails does not stop the next; the Queue consumer drops a message of a site the deployment does not serve.

## Consequences

- A person signs in once and reaches every site they are a member of, with the role they have in each. A passkey that leaks reaches all of them, as one person's laptop does.
- The admin reads every site's content through tokens of one site at a time, so nothing in it mixes two sites.
- An invitation still makes a new person: inviting someone who already has a passkey makes them a second person. Linking an invitation to a signed-in person is left for later.

## Alternatives considered

- One person per site, with a passkey for each. Rejected by the maintainer: a person who writes for two sites of the same deployment would keep two passkeys and sign in twice.
- One deployment per site. Rejected for the documentation: it doubles the Worker, the database and the setup for a site that the same people write.
