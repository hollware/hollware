# AGENTS.md

This is a Hollware project: a headless CMS on Cloudflare Workers. The content lives in D1 and is
written over MCP; this repository holds only the config and the Worker.

- `hollware.config.ts` is the source of truth for what content is valid. A change of a schema, a
  route or a style guide changes what every agent may write; `describe_site` over MCP returns it.
- `src/worker.ts` stays as it is: `createHollware(config)` is the whole Worker.
- Content is never edited in files here. Write it through the MCP tools (`create_draft`,
  `update_draft`, `validate`, `publish`) of the Hollware at `HOLLWARE_PUBLIC_URL` + `/mcp`.
- Run `pnpm test` and `pnpm exec wrangler types --check` after a change of the config or of
  `wrangler.jsonc`, and `pnpm exec hollware doctor` when something does not work.
- Never commit a token. `hollware init` and `hollware token create` print one once.
- Docs: https://hollware.com
