# Hollware

A headless CMS for the agent era, native to Cloudflare.

> [!WARNING]
> **Pre-alpha. Under construction. Nothing is usable yet.** Hollware is being built in the open, one stage at a time. The design is written and the foundations are being laid, but there is no working CMS: do not use it for anything real. What is done and what comes next is tracked in [`PLAN.md`](PLAN.md).

Hollware is designed for teams that already have a frontend and want their AI agents to write the content. Agents write Markdown over [MCP](https://modelcontextprotocol.io), contracts check every write, and sites read what was published from Hollware, which runs in your own Cloudflare account.

## Principles

Hollware's thesis is stated as five principles. They describe what Hollware is committed to be, not what exists today. If a future decision contradicts one, the decision changes or the principle is rewritten in an ADR, never silently.

1. **Headless, always.** Hollware does not render sites and has no themes. It delivers content to any frontend: Nuxt, Astro, Next or the app of a product.
2. **The agent is the primary editor.** MCP is the first-class interface. The admin exists to review and approve, and everything it does can also be done over MCP.
3. **Contracts at write time.** Quality rules run when content is written. The error goes back to the agent within milliseconds, with an instruction on how to fix it, instead of failing a CI pipeline ten minutes later.
4. **Markdown is the source of truth.** It is what agents write and read best, and it produces readable diffs. [Comark](https://comark.dev) compiles it into a derived document that can be regenerated at any time.
5. **Cloudflare-native, close to zero cost.** Every piece uses a Cloudflare primitive with a free tier, and it all deploys to your own account. The target is $0 to $5 a month for two sites.

## How it is designed to work

This is the design, not what runs today.

- **Agents write over MCP.** An agent creates or updates an entry as Markdown with frontmatter, through the Model Context Protocol.
- **Contracts validate on write.** Every write is checked against the collection's contracts: the frontmatter schema, the components allowed in the body and rules across entries. Violations come back to the agent with an instruction on how to fix them. They block publishing, not saving a draft.
- **D1 is the single source of truth.** Entries and their append-only revisions live in [D1](https://developers.cloudflare.com/d1/), Cloudflare's SQL database. An edit made on top of a stale version is rejected as a conflict instead of overwriting newer work.
- **Sites read what was published.** A site on Cloudflare reads over [Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/) through a service binding: typed, without crossing the public internet, and with no token to manage. Sites elsewhere will read over cacheable HTTP, planned for v0.2.

## Out of scope

Some things are deliberately not part of Hollware:

- Rendering sites or shipping themes.
- A visual page builder.
- A plugin marketplace.
- Running outside Cloudflare, not before v1.
- Importing from WordPress, not before v1.

## Roadmap

Each stage ends with an exit criterion that can be verified. The stage-by-stage plan, with its progress and the evidence for each step, is in [`PLAN.md`](PLAN.md).

| Stage | Name         | Goal                                                                                                                    |
| ----- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| F0    | Foundations  | A public repository that explains the thesis, with a minimal end-to-end skeleton of the stack before the first feature. |
| v0.1  | Core         | An agent writes and publishes over MCP, contracts are checked on every write, and an example site reads over RPC.       |
| v0.2  | Publishing   | Publishing is a durable, observable process: on the demo, a post is live in under a minute, with no CI.                 |
| v0.3  | Admin        | A full post can be reviewed, approved and published from the admin, without a coding agent or git.                      |
| v0.4  | Distribution | Anyone can install Hollware from the documentation, and a second site, the docs, runs on the same deployment.           |
| v0.5  | Intelligence | Agents use the existing content and its metrics to write better.                                                        |
| v1.0  | Stable       | A frozen, semver-stable API and three sites in production.                                                              |

## Packages

Six packages, planned to arrive in the order below. For now they are scaffolding: nothing in them works yet.

| Package                                       | What it will be                                                           | Arrives in |
| --------------------------------------------- | ------------------------------------------------------------------------- | ---------- |
| [`@hollware/core`](packages/core)             | Contracts, schemas and the Markdown pipeline. No Cloudflare dependencies. | v0.1       |
| [`@hollware/server`](packages/server)         | The Worker: operations, MCP, RPC, HTTP, auth and the D1 migrations.       | v0.1       |
| [`hollware`](packages/cli)                    | The CLI: init, migrate, token, import and export.                         | v0.1       |
| [`@hollware/client`](packages/client)         | The same typed interface over a service binding or over HTTP.             | v0.2       |
| [`@hollware/admin`](packages/admin)           | The review and approval UI, prebuilt and served by the Worker.            | v0.3       |
| [`create-hollware`](packages/create-hollware) | `npm create hollware`: scaffolds a new project.                           | v0.4       |

## Documentation

- [`docs/design.md`](docs/design.md): the design document, with the thesis, the architecture, the data model and the roadmap in full.
- [`docs/adr/`](docs/adr/): the architecture decision records, one for each structural decision.

## Contributing

Contributions are welcome. [`CONTRIBUTING.md`](CONTRIBUTING.md) explains how to set up the repository and what a good pull request looks like, and everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Coding agents start from [`AGENTS.md`](AGENTS.md).

Report security vulnerabilities privately, never in a public issue. [`SECURITY.md`](SECURITY.md) explains how.

## The name

_Hollow_ is a CMS with no head and no servers to run, and _hollowware_ is tableware, like teapots and pitchers, made to hold and serve. The name is also a nod to World of Warcraft's Hallow's End and its Headless Horseman.

## License

Hollware is released under the [MIT License](LICENSE).
