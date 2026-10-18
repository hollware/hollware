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
  release notes, run `pnpm test`, then `pnpm exec hollware deploy`: it deploys the Worker and applies
  the new migrations to the remote database. Migrations only move forward; content stays as it is.
- Never commit a token. `hollware init` and `hollware token create` print one once.
- Docs: https://hollware.com
