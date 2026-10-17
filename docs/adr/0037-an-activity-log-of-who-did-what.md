# ADR-037: An activity log of who did what

Status: Accepted (2026-10-17)

## Context

Hollware already keeps, append-only and in the same batch as the change, who wrote each revision,
who published or scheduled each entry (ADR-021) and who changed the structure of a site
(`site_changes`, ADR-033). That covers what readers see. It leaves out what decides who may change
it: the tokens made and revoked, the people added, given a role or removed, the invitations, the
passkeys, the apps a person allowed, the sessions ended, and every attempt that was refused. An
owner who has to answer "who did this, and through what" for compliance has to read four tables
and still finds no answer for those.

The actors are of four kinds: a person in the admin, a personal token (which is how an agent such
as `@hollware/agents` gets in), an app a person allowed through OAuth, and the deployment itself
(the cron that publishes what was scheduled). What a client says about itself (its MCP client
name, its model) is its own claim; the token or grant that let it in is what Hollware verified.

The address a request came from is personal data under the GDPR and Chile's law 21.719. Whether a
site keeps it, and for how long a site keeps its log, is the owner's decision, not Hollware's.

## Decision

**One table, `audit_log`, for every change and every refusal of a site.** A line holds:

- **When:** `created_at`, and the `request_id` that ties it to Workers Logs.
- **Who:** `actor_kind` (`user`, `token`, `oauth_client`, `system`), the user, the token or the
  OAuth client id that Hollware verified, and in `actor_meta` what the client declared about
  itself. The user is an id with no foreign key: the line outlives the person, and erasing a
  person's name from `users` leaves the log pseudonymous instead of rewriting it.
- **What:** `action`, one of the actions of `AUDIT_ACTIONS` in `@hollware/core`: the name of every
  operation that is not a read (`publish`, `update_site`…) and the actions of identity
  (`token.create`, `member.role`, `passkey.remove`, `app.allow`…). A line of no other action is
  refused by the type and by a test.
- **On what:** `target_type` and `target_id`, and a small `detail` (a role, a label, scopes),
  never a secret, a token or the content of an entry: those live in their own tables.
- **How it ended:** `outcome` is `ok`, `denied` (a scope or a role was missing) or `failed`, with
  the `error_code` of the error the caller got.
- **From where:** `ip_hash`, only when the site keeps addresses.

**Who writes it.**

- Every operation goes through one place, the call of its handler by MCP and by the ops API. Every
  call of an operation that is not a read gets one line, with its outcome, whether it changed
  something, was refused (a missing scope) or failed. Reads change nothing and are many; Workers
  Logs keep them.
- The admin's routes of identity name their action, and get a line for every answer but a 400: a
  token made or revoked, a role, a member removed, an invitation. A change of a person's own
  sign-in (a passkey removed, an app revoked, every session ended), and the pages that sign a
  person in and out and accept an invitation, write a line in each site the person belongs to,
  since a person is of the deployment. The consent of OAuth writes one in the site of the grant.
- The cron writes a line for each entry it publishes for the person who scheduled it, as the
  deployment (`system`) acting for that person.
- A refusal before Hollware knows the site (no token, a wrong token, an unknown passkey) has no
  site to be logged in; the rate limit (T-10) and Workers Logs cover it.
- A line is written after its change, before the answer, in its own write: the revision,
  publication, schedule or change of structure that the change made already holds its actor,
  append-only, in the same batch as the change. A line that cannot be written is logged as
  `audit_write_failed`, and the answer is the change's.

**The owner decides two things, in the site's definition** (`audit` of `update_site`, and the
admin's settings), and the change of either is itself in `site_changes` and the log:

- `ipAddresses`: `off` by default. `hashed` keeps an HMAC-SHA256 of the address (`cf-connecting-ip`)
  under a key of the site, derived with HKDF from the Worker secret `HOLLWARE_SECRET`: one address
  gives the same hash within a site, so attempts can be told apart, and without the secret no hash
  can be turned back into its address, which a plain hash of the 2³² IPv4 addresses could. The
  raw address is never stored. A Worker without the secret stores no hash, and logs it.
- `retentionDays`: `null` by default, which keeps the log for as long as the site exists; else 30
  to 3650. The cron deletes the lines older than that.

**The log is append-only in D1.** Triggers refuse every update, every replace of a line by its id,
and every delete of a line younger than its site's retention, so not even a script with the
database's credentials can rewrite the recent history.

**Owners read it**, on the admin's Activity page and its CSV, filtered by actor, action, target and
dates. Editors and authors do not: the log names people and their tokens.

## Consequences

- An owner answers "who did this, through what, and was it refused" from one page.
- A new operation or action is not logged until it is named in `AUDIT_ACTIONS`, and a test lists
  every action that each route and operation writes, so a new one fails until it is classified.
- The log grows with every write. A site that does not want that sets its retention.
- A line can be missing if D1 fails between the change and its line. A change of content or
  structure still names its actor, and the failure is logged.
- `create-hollware` asks both questions at install; `--yes` keeps the defaults (no addresses,
  kept forever).

## Alternatives considered

- **Lines written by triggers on the tables they describe.** Atomic, but a trigger knows neither
  the request, nor the client, nor a refusal, and an identity change touches tables (KV for OAuth
  grants) that D1 does not see.
- **The line in the batch of its change.** Every write of the store and of the identity routes
  would have to take the line, and an operation decides its outcome after its batch; the records
  of the content and the structure are already atomic with their actor, so the coupling buys
  little.
- **Raw addresses, or a plain SHA-256 of them.** The first keeps personal data that most sites do
  not need; the second only looks anonymous.
- **Workers Logs as the log.** They are kept for days, not years, and an owner of a site cannot
  read them.
