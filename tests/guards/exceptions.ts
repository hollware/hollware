/**
 * Every exception a guard allows, in one place.
 *
 * An exception list may only shrink. Each list records its size in `max`, and the
 * `exceptions` meta-test fails when the list is longer than `max` (an exception was added
 * without anyone raising the number on purpose) and also when it is shorter (an exception
 * was removed and the number is stale, which would leave room for a silent addition later).
 * The guards that consume a list (`agents-paths`, `workflow-forbidden`) also fail on an
 * entry that no longer applies, so a fixed problem cannot leave its exception behind. The
 * directories of `OTHER_TEST_RUNNERS` are bound to the `exclude` of the `repo` project in
 * `vite.config.ts` instead, and each one names the task that runs its tests: `test-projects`
 * fails once a test file exists there and that task is not a task of the root `vite.config.ts`
 * that CI runs.
 *
 * Guards never hold exceptions of their own: they receive them as arguments, and the
 * `exceptions` meta-test reports a list declared anywhere else.
 */

export interface Exception {
  /** What is allowed, in the format the guard documents. */
  value: string
  /** Why it is allowed. An exception without a reason is not accepted. */
  reason: string
}

export interface ExceptionList {
  /** The recorded size of the list. Lower it when an exception goes away; never raise it. */
  max: number
  entries: readonly Exception[]
}

/**
 * Backticked paths in `AGENTS.md` and `README.md` files that do not exist in the repository
 * (guard `agents-paths`). The value is the text between the backticks.
 */
export const MISSING_DOC_PATHS: ExceptionList = {
  max: 5,
  entries: [
    {
      value: 'NNNN-kebab-case-title.md',
      reason: 'The ADR file-name template in docs/adr/README.md.',
    },
    {
      value: 'CLAUDE.md',
      reason: 'Named only to say that it must never exist (guard `no-claude-md`).',
    },
    {
      value: 'action.yml',
      reason: 'The metadata file of a third-party action, read at its pinned commit.',
    },
    {
      value: 'publish-plan.json',
      reason: 'Written by the pack job of release.yml at run time and never committed.',
    },
    {
      value: 'changesets/action/pack',
      reason: 'A GitHub action reference (owner/repo/subpath), not a path of this repository.',
    },
  ],
}

/**
 * Inline `zizmor: ignore[...]` directives allowed in workflows and scripts (guard
 * `workflow-forbidden`). The value is `<file>#<directive>`.
 */
export const ZIZMOR_IGNORES: ExceptionList = {
  max: 1,
  entries: [
    {
      value: '.github/workflows/ci.yml#zizmor: ignore[use-trusted-publishing]',
      reason:
        'pkg.pr.new previews are published to pkg.pr.new, not to npm, so trusted publishing does not apply.',
    },
  ],
}

/**
 * Imports of a module that a framework's Vite plugin makes at build time, so no package has it
 * (guard `declared-imports`). The value is `<file>#<specifier>`.
 */
export const VIRTUAL_IMPORTS: ExceptionList = {
  max: 1,
  entries: [
    {
      value: 'examples/react-router-blog/workers/app.ts#virtual:react-router/server-build',
      reason:
        'The Worker entry that React Router documents for Cloudflare imports the server build that its Vite plugin makes of the routes; there is no way to write that file without it.',
    },
  ],
}

/** A directory of tests that run through a task of their own, and not through `vp test`. */
export interface TestRunner {
  /** The directory, with a trailing `/`. The root `vite.config.ts` excludes it from `repo`. */
  dir: string
  /** The task of the root `vite.config.ts` that runs it: `vp run <task>`. */
  task: string
  /** Why it has a runner of its own. An exception without a reason is not accepted. */
  reason: string
}

export interface TestRunnerList {
  /** The recorded size of the list. Lower it when a directory goes away; never raise it. */
  max: number
  entries: readonly TestRunner[]
}

/**
 * Directories whose `*.test.ts` files run through a task of their own and not through a project
 * of `vp test` (guard `test-projects`). The root `vite.config.ts` excludes the same directories
 * from the `repo` project. While a directory holds no test file, its task need not exist; once
 * it does, the task must be defined in the root `vite.config.ts` and run by CI, or the guard
 * fails: an exemption must not hide tests that nothing runs.
 */
export const OTHER_TEST_RUNNERS: TestRunnerList = {
  max: 3,
  entries: [
    {
      dir: 'tests/acceptance/',
      task: 'test:acceptance',
      reason: 'Stage acceptance suites run with `vp run test:acceptance` (arrives in v0.1).',
    },
    {
      dir: 'tests/conformance/',
      task: 'test:conformance',
      reason: 'The MCP conformance suite runs with `vp run test:conformance` (arrives in v0.1).',
    },
    {
      dir: 'tests/e2e/',
      task: 'e2e:admin',
      reason:
        'The admin runs in Chromium under Playwright, with `vp run e2e:admin` (arrives in v0.3).',
    },
  ],
}

/**
 * Tables of the D1 schema without `site_id` (guard `schema`). Every other table belongs to a
 * site, with `UNIQUE(id, site_id)` and composite foreign keys.
 */
export const TABLES_WITHOUT_SITE: ExceptionList = {
  max: 6,
  entries: [
    {
      value: '_hollware_meta',
      reason:
        'Created by the shipped migration 0000_init.sql, which is never edited: metadata of the deployment, not of a site.',
    },
    { value: 'sites', reason: 'The table that `site_id` points at: its id is the site.' },
    {
      value: 'users',
      reason:
        'A user belongs to the deployment and may work on several sites; the tokens carry the site (ADR-019).',
    },
    {
      value: 'passkeys',
      reason:
        'A person signs in to the deployment, not to a site (v0.4, maintainer, 2026-10-15): one passkey for every site they are a member of.',
    },
    {
      value: 'sessions',
      reason:
        "A session is the signed-in person, across sites (v0.4); the site of a request is the grant's or the token's.",
    },
    {
      value: 'auth_challenges',
      reason: 'A sign-in has no site (v0.4); a registration names its invitation, which has one.',
    },
  ],
}

/** Tables without the shared `id`, `created_at` and `updated_at` columns (guard `schema`). */
export const TABLES_WITHOUT_SHARED_COLUMNS: ExceptionList = {
  max: 1,
  entries: [
    {
      value: '_hollware_meta',
      reason:
        'Created by the shipped migration 0000_init.sql, which is never edited: a key and a value.',
    },
  ],
}

/** Files that hold an invisible character on purpose (guard `invisible-characters`). */
export const INVISIBLE_CHARACTER_FILES: ExceptionList = {
  max: 1,
  entries: [
    {
      value: 'tests/fixtures/content/hostile/bom.md',
      reason:
        'A fixture that starts with a byte order mark on purpose: the Markdown pipeline must remove it.',
    },
  ],
}

/**
 * Texts that a template of the admin may show as they are, outside its messages (guard
 * `admin-messages`). The value is the text, trimmed, as the template holds it. None is needed
 * today: a brand or a code identifier goes through the messages too.
 */
export const ADMIN_TEXT_LITERALS: ExceptionList = {
  max: 0,
  entries: [],
}

/**
 * Texts that a template of hollware.com (`apps/web`) may show as they are, outside its messages
 * (guard `admin-messages`, run on the site too). The value is the text, trimmed, as it stands.
 */
export const WEB_TEXT_LITERALS: ExceptionList = {
  max: 4,
  entries: [
    {
      value: 'llms.txt',
      reason: 'The name of a file of the site for language models, the same in every language.',
    },
    {
      value: 'GitHub',
      reason: 'The name of a service, on the button that leads to the repository.',
    },
    {
      value: 'Hollware',
      reason: 'The name of the product, the title of the header in every language.',
    },
    {
      value: 'agent → hollware /mcp',
      reason: 'The title bar of the agent session on the landing page: an endpoint, not words.',
    },
  ],
}

/**
 * Operations of MCP that the admin does not call by name, because a person does the same thing
 * there another way (guard `admin-parity`). The value is the name of the operation.
 */
export const OPERATIONS_WITHOUT_ADMIN: ExceptionList = {
  max: 2,
  entries: [
    {
      value: 'get_asset',
      reason:
        'The Images page lists each image whole with list_assets; one more read adds nothing.',
    },
    {
      value: 'request_review',
      reason:
        'In the admin, Publish without content:publish asks for the review, as publish does over MCP.',
    },
  ],
}

/** The list as `value` and `reason`, which is what the `exceptions` meta-test reads. */
function byValue(list: TestRunnerList): ExceptionList {
  return {
    max: list.max,
    entries: list.entries.map((entry) => ({ value: entry.dir, reason: entry.reason })),
  }
}

/** Every list, by name, for the meta-test that keeps them honest. */
export const EXCEPTION_LISTS: Readonly<Record<string, ExceptionList>> = {
  MISSING_DOC_PATHS,
  ZIZMOR_IGNORES,
  VIRTUAL_IMPORTS,
  OTHER_TEST_RUNNERS: byValue(OTHER_TEST_RUNNERS),
  TABLES_WITHOUT_SITE,
  TABLES_WITHOUT_SHARED_COLUMNS,
  INVISIBLE_CHARACTER_FILES,
  ADMIN_TEXT_LITERALS,
  WEB_TEXT_LITERALS,
  OPERATIONS_WITHOUT_ADMIN,
}

export function exceptionValues(list: ExceptionList): string[] {
  return list.entries.map((entry) => entry.value)
}
