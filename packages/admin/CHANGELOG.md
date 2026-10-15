# @hollware/admin

## 0.4.0

### Minor Changes

- [`85e70a2`](https://github.com/hollware/hollware/commit/85e70a22adc4b1e256f9a0af57b33ca4ba4a9881) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin takes the look of hollware.com: ink greys and a mint accent, Geist and Geist Mono bundled with it, dark by default, and Markdown colors in the editor from the same theme. The sign-in, setup and consent pages of the Worker share it.

- [`43333d3`](https://github.com/hollware/hollware/commit/43333d309843e464c47b20412d2d1d05738c835a) Thanks [@sergioazoc](https://github.com/sergioazoc)! - A deployment serves every site of its config (ADR-027). A personal token, an OAuth grant and an RPC call each act on the one site they name; a person has one passkey and one session for the deployment, with a role per site. The consent page asks which site when the person is in several, the admin switches sites (`GET /v1/admin/me`), and `hollware init --site <key>` on a database with an owner adds the site to that owner. Migration `0006_people_across_sites.sql` drops `site_id` from passkeys, sessions and sign-in challenges.

- [`a7b5f26`](https://github.com/hollware/hollware/commit/a7b5f261d08bf8b58e3dc98ee0a7148de71d394b) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Read tokens and CORS for the read API (ADR-028). A read token (`hw_read_`) reads the published content of one site over `GET /v1/…` and is refused everywhere else; make one with `hollware token create --read` or in the admin. A site lists the origins of its pages in `cors.origins`, and those pages may read it from the browser. Migration `0007_read_tokens.sql` adds the `kind` of a token.

## 0.3.0

### Minor Changes

- [`bf0d98c`](https://github.com/hollware/hollware/commit/bf0d98cf151ddb7ae4167ffa43e92cdd2a1709ae) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin's screens. A person signs in with their passkey (the admin is the server's own OAuth client, with PKCE, and keeps its token in memory), lists the entries of a collection, creates a draft from the fields its collection requires, edits the Markdown in CodeMirror with the verdict as diagnostics and the saved revision's HTML beside it, saves, and publishes, acknowledging warnings when asked; without `content:publish`, publishing asks for a review. The review queue shows what is live beside the revision asked for, with its verdict, and approves it or asks for changes. A review now carries `requestedByName`.

- [`56f72c6`](https://github.com/hollware/hollware/commit/56f72c6a71155a05a4ceb9a350bf3f062838bd9f) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin's groundwork. The server answers the operations over HTTP at `POST /v1/ops/{name}`, with the input and output of the MCP tool of that name, registers the admin as its own OAuth client (no consent page), and serves the admin at `/admin/` from the Worker's static assets, with a policy that runs only its own scripts. `@hollware/admin` builds a Vue single-page app and exports `adminAssets()`, the directory a project's Vite config serves as its `publicDir`; a project binds its static assets as `ASSETS`.

- [`aefb102`](https://github.com/hollware/hollware/commit/aefb1026078d3e860a7b6731953b8bec3a78d4ab) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Tokens and people in the admin. An owner signed in to the admin makes, lists and revokes personal tokens (a token is shown once, and gets no scope its maker lacks), and invites editors and authors with a link to `/setup`. These are routes of the admin's own (`/v1/admin/…`), not operations: they take only an access token of the admin's client with `schema:admin`, so neither a personal token nor another MCP client can make a token.

### Patch Changes

- [`59a8989`](https://github.com/hollware/hollware/commit/59a898963cbda2cb9bb4bb81bfbec48fa846c286) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The admin passes axe: its colors in light mode reach a contrast of 4.5:1, the line numbers of the editor too, and the two sides of a review's diff are named.

## 0.2.0

No changes in this release.

## 0.1.0

No changes in this release.

## 0.0.2

### Patch Changes

- [`d834e1e`](https://github.com/hollware/hollware/commit/d834e1e6cff6d04795842f0d847af64067f104af) Thanks [@sergioazoc](https://github.com/sergioazoc)! - Releases now ship from the `release` branch and are published directly from CI with provenance, after the maintainer approves the `npm` environment (ADR-015). The packages themselves are unchanged.

## 0.0.1

### Patch Changes

- [`622b862`](https://github.com/hollware/hollware/commit/622b8621227246aec6425471de2b257516cea3e0) Thanks [@sergioazoc](https://github.com/sergioazoc)! - First release: the package skeletons. Nothing is usable yet; this release proves the publishing pipeline end to end.
