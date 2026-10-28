# AGENTS.md

This is a Hollware project: a headless CMS on Cloudflare Workers. The content and the structure
of the sites live in D1; this repository holds only the Worker.

- The structure of a site (its collections, the JSON Schema of their frontmatter, routes, rules,
  style guides) is data: read it with `get_structure`, change it with `update_site` or
  `set_collection` (they need `schema:admin`), or in the admin at `/admin/`. It applies at once;
  nothing here changes and nothing is deployed.
- `src/worker.ts` stays as it is: `createHollware()` is the whole Worker.
- Content is never edited in files here. Write it through the MCP tools (`create_draft`,
  `update_draft`, `validate`, `publish`) of the Hollware at `HOLLWARE_PUBLIC_URL` + `/mcp`.
- Run `pnpm test` and `pnpm exec wrangler types --check` after a change of `wrangler.jsonc`, and `pnpm exec hollware doctor` when something does not work.
- To update Hollware, move `hollware`, `@hollware/core`, `@hollware/server` and `@hollware/admin`
  to one new version together, as exact versions
  (`pnpm add -E hollware@X @hollware/core@X @hollware/server@X @hollware/admin@X`), read its
  release notes, and compare this project with one that `create-hollware` of that version makes
  (`--no-install --no-git`): take its tool versions and the changes to files of the project. Run
  `pnpm exec hollware migrate --local` and `pnpm test`, then `pnpm exec hollware deploy`: it applies
  the new migrations to the remote database, then deploys the Worker. Migrations only move forward;
  content stays as it is. Guide: https://hollware.com/docs/upgrade/
- Never commit a token. `hollware init` and `hollware token create` print one once.
- Docs: https://hollware.com

## wrangler.jsonc

`pnpm exec hollware doctor` checks each of these and says the fix.

- `no_nodejs_compat` and `no_nodejs_compat_v2` keep Node.js compatibility off: Hollware runs and
  is tested without it. Remove both only if your own code needs Node.js APIs.
- `global_fetch_strictly_public`: the OAuth server fetches the metadata documents of clients, and
  `upload_asset` the URL an agent gives, over the public internet only, never through your zone.
- The cron runs every minute: it publishes the scheduled entries and sends the events the queue
  missed. The `EVENTS` queue carries the publication events; the Worker consumes them and keeps
  what fails five times in the dead-letter queue. Queue names are unique in an account.
- `assets` is the admin, at `/admin/`: its hashed files go straight to the browser, every other
  request reaches the Worker first.
- `HOLLWARE_PUBLIC_URL` is the only Host and Origin the Worker answers. `hollware deploy` sets it
  to the workers.dev URL, or to `--url` (a domain of its own gets its route): commit it.
  `pnpm dev` always serves `http://localhost:5199`, the port of `vite.config.ts`.
- `DB` and `OAUTH_KV` have no id: the first `hollware deploy` creates them and writes the id here.
  Local development needs none. The migrations are those `@hollware/server` ships; apply them with
  `hollware migrate`, never by hand.
- `HOLLWARE_RATE_LIMIT`: sign-in and the OAuth token endpoint take 60 requests a minute per address.
- `MEDIA` (R2) keeps the images and the backups; without it `upload_asset` is unavailable. `IMAGES`
  converts each image once; without it images are kept as they come.
- `HOLLWARE_SECRET` seals the secrets Hollware keeps (webhooks, analytics keys) and signs preview
  links. `pnpm dev` uses a fixed value; the first `hollware deploy` gives the Worker its own.
  Never replace it: what it sealed is lost.
