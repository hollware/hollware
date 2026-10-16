# hollware

The command line of [Hollware](https://github.com/hollware/hollware), an open-source headless
CMS for the agent era, native to Cloudflare Workers.

> **Status: pre-alpha.** `init`, `migrate`, `deploy`, `doctor`, `token`, `invite` and `import`
> work, against a Hollware that is still being built. POSIX shells only: it has not been tried on
> Windows.

## Commands

| Command   | Purpose                                                                          |
| --------- | -------------------------------------------------------------------------------- |
| `init`    | Create a site, its owner and a first personal token in the project's D1 database |
| `migrate` | Apply D1 migrations; `--check` lists the pending ones, `--remote` backs up first |
| `deploy`  | Deploy to Cloudflare, creating what the project needs, and migrate the database  |
| `doctor`  | Check the project, its bindings, its database and its owner, with what to fix    |
| `token`   | Create, list and revoke personal tokens, and read tokens with `--read`           |
| `invite`  | Invite a person to the admin, as an editor or an author                          |
| `import`  | Import Markdown files over MCP, as drafts, and publish them with `--publish`     |
| `export`  | Export entries as Markdown files (v0.2)                                          |

Every command answers `--help`. A command that fails prints one message on stderr, with what to
do, and exits with code 1.

## A first run

In a Hollware project (the starter has the D1 binding `DB` in its `wrangler.jsonc`):

```sh
hollware migrate                         # create the tables in the local database
hollware init --site blog                # create the site and its owner; prints a token, once
hollware token create --label ci --scopes content:read,content:write
hollware token list                      # never shows a hash
hollware token revoke tok_01JAB3XQ8ZK4M6N2P5R7S9T0VW
```

To put it on Cloudflare, log in with `wrangler login` and run `hollware deploy`: the first deploy
creates the D1 database, the KV namespace and the queues, writes their ids and the public URL of
the Worker into `wrangler.jsonc`, and applies the migrations. Then `hollware init --site blog
--remote` makes the site in it.

Add `--remote` to work on the database in Cloudflare instead (it needs `wrangler login` or a
`CLOUDFLARE_API_TOKEN`). `migrate --remote` first exports the database to
`.wrangler/hollware-backups` and stops if that fails; a new database, with none of the
migrations, has nothing to back up. `--database <name>` picks another D1
database than the binding `DB`. `--site <key>` picks a site when the database has several.

Put the token that `init` printed in a file only you can read, and import a directory of
Markdown, laid out as `<collection>/<locale>/<slug>.md`, into a running Hollware:

```sh
hollware import ./content --url https://cms.example.com --token-file ./token.txt --dry-run
hollware import ./content --url https://cms.example.com --token-file ./token.txt --publish
```

`import` validates every file first and writes nothing if one would be refused. Running it
again changes nothing: every entry answers `unchanged`. With `--publish` it publishes the
entries that have unpublished changes, and it acknowledges no warning: an entry with warnings is
reported, and the command exits with code 1. The token never appears in its output.

## How it works

`init`, `migrate`, `deploy`, `doctor` and `token` run the project's own `wrangler` (the nearest
`node_modules/.bin/wrangler`) against its D1 database, and read the binding from `wrangler.jsonc`.
`import` speaks MCP to `<url>/mcp` with the token as a bearer token. The structure of the sites
lives in the database (ADR-033): `init` gives a new site its first definition from a preset, and
its owner shapes it in the admin, or an agent over MCP.

## Links

- Repository: <https://github.com/hollware/hollware>
- Issues: <https://github.com/hollware/hollware/issues>
- License: MIT
