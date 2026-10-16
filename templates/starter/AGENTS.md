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
- Never commit a token. `hollware init` and `hollware token create` print one once.
- Docs: https://hollware.com
