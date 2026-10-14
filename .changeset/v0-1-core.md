---
'@hollware/core': minor
'@hollware/server': minor
'hollware': minor
---

v0.1, the core: an agent writes and publishes Markdown over MCP, contracts check every write, and a site reads what is published over a service binding.

- `@hollware/core`: the config (`defineConfig`, `defineCollection`, `defineComponent`), the contracts and their opt-in factories, the nine operation specs and the Markdown pipeline on Comark.
- `@hollware/server`: `createHollware(config)`, the Worker with the MCP endpoint behind personal tokens and the read-only `Hollware` entrypoint for sites, and the D1 migrations.
- `hollware`: the CLI's `init`, `migrate`, `token` and `import`.
