# hollware (the CLI)

The `hollware` command. Boundary rules for this package:

- It never loads `hollware.config.ts`. It works on the project through the project's own `wrangler`
  (the nearest `node_modules/.bin/wrangler` from the working directory upwards, never a global one,
  never `npx`) and on a running Hollware over MCP. Bound by `tests/boundary.test.ts` (a config that
  cannot be read and leaves a marker if it is loaded) and `tests/wrangler.test.ts`.
- `main(argv, io)` in `src/index.ts` only uses its arguments. `Io` (`src/io.ts`) is everything a
  command takes from outside: the streams, the working directory, the clock, random bytes, stdin,
  wrangler and a temporary directory. The entry-point block at the bottom of `src/index.ts` builds
  the real one, and is the only code that touches `process`. Bound by `tests/boundary.test.ts`,
  which scans `src` for `process`.
- Never read `process.env`: configuration arrives as arguments. A child process still inherits the
  environment, which is where wrangler finds its Cloudflare credentials.
- A command is loaded when it runs (`run` in `src/index.ts`), so `--help` and `--version` do not
  load the MCP client. Bound by `tests/boundary.test.ts` (`src/index.ts` imports no command and no
  dependency at the top).
- A failure a person can act on is a `CliError` (a mistake in the arguments is a `UsageError`):
  `main` prints one message on stderr behind the command words and returns 1. Anything else is a
  bug and escapes, except in `import`, which turns it into a `CliError` because the token is in
  memory.

## SQL

- `src/sql.ts` is the only place that builds SQL. Every statement is a fixed template, and a value
  enters it only as a SQL string literal (`quote`, with `'` doubled), after a `parse…` validator:
  ids with `isId`, scopes with `isScope`, labels by length and characters (no control, invisible
  formatting or line-separator characters), site keys, days and database names by pattern. Nothing
  a person types can change a statement. Bound by `tests/sql.test.ts`, `tests/token.test.ts` and
  `tests/init.test.ts` (hostile labels, the exact SQL given to wrangler) and by
  `tests/integration.test.ts` (the real SQL splitter of wrangler and SQLite).
- `token list` never selects or prints the hash. `init` and `token create` print the token once
  and store only its SHA-256.
- `init` asks first whether an owner exists (`wrangler d1 execute --json --command`) and refuses
  without writing when one does. It then runs one script from a SQL file in a private directory
  (`io.tempDir`), which D1 runs as one transaction, and removes the directory in a `finally`.
  Bound by `tests/init.test.ts` and by `tests/integration.test.ts`, where a script that fails on its
  last statement leaves the earlier ones unwritten.
- The first token has every scope and 90 days (`PERSONAL_TOKEN_TTL_DAYS`). `token create` has
  `content:read,content:write` and 90 days by default, and at most 365 days.
- `src/d1.ts` reads the D1 binding `DB` of `wrangler.jsonc` (JSON with comments, `src/jsonc.ts`)
  unless `--database` names one, and turns the `--json` answer of wrangler into rows.
- Every command defaults to the local database, and always passes `--local` or `--remote` to
  wrangler explicitly.

## Migrations

- `migrate` lists first (`wrangler d1 migrations list`) and reads only two answers: "No migrations
  to apply!" and the table headed "Migrations to be applied:". Any other answer is an error, so a
  wrangler that words it differently never reads as up to date. It applies only what is pending,
  and for `--remote` it exports a backup to `.wrangler/hollware-backups` first, and stops if
  `wrangler d1 export` fails or leaves no file. With nothing pending it takes no backup (an
  export locks the database). Bound by `tests/migrate.test.ts`.

## Import

- Files are `<directory>/<collection>/<locale>/<slug>.md`. A Markdown file elsewhere is skipped and
  reported; a bad slug or bytes that are not UTF-8 stop the import before it connects. Symbolic
  links and hidden files are never read. The text is sent byte for byte, byte order mark included.
  Bound by `tests/corpus.test.ts` and `tests/import.test.ts`.
- Every file goes through `validate` first. A refusal-level violation (`REFUSAL_CONTRACTS` in
  `src/commands/import.ts`: `size-limit`, `frontmatter-syntax`, `comark-parse`, which mirror the
  contracts that make a write `refused`) or a failed `validate` stops the import before any write.
  Other errors are saved with the draft.
- Phase one writes drafts: `get_entry`, then `create_draft` when it is `not_found`, else
  `update_draft` at the version read (`unchanged` when the Markdown is the same). A second run of
  the same import changes nothing. Phase two, with `--publish`, publishes each entry that has
  unpublished changes and acknowledges no warning; nothing is published when a draft failed.
- The token comes from `--token-file` or stdin, never from an argument or an environment
  variable. `--url` must be https (http only for localhost), has no credentials, and a redirect to
  another origin is not followed. Everything `import` prints, and every error it throws, goes
  through `redact`, so the token is in none of it.
- `src/import/session.ts` calls the operations with the specs of `@hollware/core` (input and
  output schemas), so an outcome that is an error for the caller (`not_found`, `conflict`,
  `blocked`) is an answer, and turns transport failures (401, 403, 404, no connection) into
  messages that say what to do.

## Tests

- Every test file starts with a `// Fails when:` header that names, for each test, the production
  change that fails it. A new test names its line, or it is not written.
- `tests/support/fake-wrangler.ts` fakes wrangler, which this repository does not own, to pin the
  exact arguments and SQL. `tests/support/stub-hollware.ts` is a Hollware stand-in: an MCP server
  built with `@modelcontextprotocol/server` over HTTP on a random port, with stateful tools that
  use the operation specs of `@hollware/core`. It follows the specs and the plan, and must change
  with them. `tests/integration.test.ts` runs the real wrangler on a local D1 with the migrations
  of `@hollware/server`; it makes about thirty wrangler calls and takes the longest (minutes on a busy machine).
- `tests/support/install.ts` copies `src` next to a manifest the test controls, to run the bin as a
  process and read its version.
- No source file holds an invisible character (a byte order mark, a zero-width mark, a
  bidirectional control). Write one as an escape (`\u202E`) or with `String.fromCharCode`. Bound by
  `tests/boundary.test.ts`.
