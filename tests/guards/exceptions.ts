export interface Exception {
  value: string
  reason: string
}

export interface ExceptionList {
  max: number
  entries: readonly Exception[]
}

export const MISSING_DOC_PATHS: ExceptionList = {
  max: 4,
  entries: [
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

export interface TestRunner {
  dir: string
  task: string
  reason: string
}

export interface TestRunnerList {
  max: number
  entries: readonly TestRunner[]
}

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
        'A user belongs to the deployment and may work on several sites; the tokens carry the site.',
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

export const ADMIN_TEXT_LITERALS: ExceptionList = {
  max: 0,
  entries: [],
}

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

export const WORKERS_WITHOUT_EVENTS: ExceptionList = {
  max: 2,
  entries: [
    {
      value: 'packages/server/wrangler.jsonc',
      reason:
        'Never deployed: the tests of the server run under it and call its scheduled and queue handlers themselves.',
    },
    {
      value: 'tests/conformance/worker/wrangler.jsonc',
      reason:
        'Never deployed: the MCP conformance suite runs against it under wrangler dev and calls no scheduled or queued work.',
    },
  ],
}

export const DOC_REF_FILES: ExceptionList = {
  max: 2,
  entries: [
    {
      value: '**/CHANGELOG.md',
      reason: 'Generated release history: it keeps what each release said when it shipped.',
    },
    {
      value: 'PLAN.md',
      reason: 'The roadmap while 1.0 is built; it is deleted when 1.0 ships.',
    },
  ],
}

function byValue(list: TestRunnerList): ExceptionList {
  return {
    max: list.max,
    entries: list.entries.map((entry) => ({ value: entry.dir, reason: entry.reason })),
  }
}

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
  WORKERS_WITHOUT_EVENTS,
  DOC_REF_FILES,
}

export function exceptionValues(list: ExceptionList): string[] {
  return list.entries.map((entry) => entry.value)
}
