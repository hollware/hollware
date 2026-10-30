# worker-site

A blog on a Cloudflare Worker that reads Hollware the way a real site does: over a service binding
(Workers RPC), with no network in between and no token. It serves what an agent published over MCP,
and it cannot reach a draft, because the binding only reads the published view.

## What it serves

| Path                                   | What it is                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/blog/` and `/en/blog/`               | The published entries of a locale, newest first, `?tag=` filters and `?cursor=` pages      |
| `/blog/<slug>/` and `/en/blog/<slug>/` | One published entry as HTML, with links to its published translations                      |
| the same paths without the final `/`   | A 301 to the path with it                                                                  |
| anything else, and an unpublished slug | A 404: a draft, an entry that was unpublished and one that never existed are the same page |

The routes mirror the `routes` of the `blog` collection in `apps/playground/hollware.config.ts`,
because the internal links in an entry's Markdown point at them (`src/routes.ts`).

## How it reads Hollware

`wrangler.jsonc` binds `HOLLWARE` to the `Hollware` entrypoint of the Worker `hollware-playground`.
The binding has seven methods, which `HollwareRpc` of `@hollware/server` types, and nothing that
writes. The Worker calls them in `src/index.ts`:

- `listEntries` for the index, with the locale, the tag, a page of `PAGE_SIZE` entries and the
  cursor that the answer gave for the next one;
- `getEntry` with `formats: ['document']` for an entry. The site renders the stored Comark
  document with `renderHtml` of `@hollware/core`, which prints nothing it has not checked, so the
  page holds no raw HTML, event handler or unsafe URL whatever the document says. The Markdown is
  never parsed here;
- `getTranslations` for the links to the other locales.

Everything an author wrote reaches a page through `escapeHtml` (`src/pages.ts`), and a failure of
Hollware reaches the visitor as a 400 or a 502 with no detail. The Worker logs one JSON line for
each, with the `name`, `message`, `code` and `fix` of the error Hollware sent.

`HollwareRpc` types the binding by hand (`src/env.ts`): Cloudflare's `Service<...>` turns every
answer that holds `unknown`, such as an entry's frontmatter, into `never`.

## Run it

The site needs a Hollware to read. In one terminal, the playground serves one at
`http://localhost:5199`:

```sh
cd apps/playground
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev
```

Create a site and a token for it, and import the synthetic corpus the tests use. The `hollware`
CLI of `packages/cli` does both:

```sh
node ../../packages/cli/src/index.ts init --site playground --local
# copy tests/fixtures/content/blog into a directory called corpus/blog, then:
node ../../packages/cli/src/index.ts import corpus --url http://localhost:5199 --token-file <file with the token> --publish
```

In another terminal, this site serves it at `http://localhost:5174`. The two dev servers find each
other through the service binding:

```sh
cd examples/worker-site
pnpm dev --port 5174
```

## Commands

| Command            | What it does                                         |
| ------------------ | ---------------------------------------------------- |
| `pnpm dev`         | Serve the Worker locally with Vite                   |
| `pnpm build`       | Build the Worker into `dist/`, minified              |
| `pnpm test`        | Run the unit tests of the routes and the pages       |
| `pnpm types`       | Regenerate `worker-configuration.d.ts`               |
| `pnpm types:check` | Fail when `worker-configuration.d.ts` is out of date |

What this Worker does with a real Hollware is tested in the playground, which runs both built
Workers together over the real binding: `apps/playground/test/harness`.

`src/probe.ts` and the `PROBE` binding of `wrangler.jsonc` are for those tests only: they let the
harness ask the built Worker which Node.js globals it has, since the Worker runs without Node.js
compatibility. A site of your own has neither.
