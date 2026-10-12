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
 * `vite.config.ts` instead.
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
  max: 7,
  entries: [
    {
      value: 'hollware.config.ts',
      reason:
        'The config file of a Hollware project, which lives in user projects and the v0.1 playground, not here.',
    },
    {
      value: 'examples/worker-site',
      reason: 'Arrives in v0.1; examples/README.md announces it.',
    },
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
 * Directories whose `*.test.ts` files run through a command of their own and not through a
 * project of `vp test` (guard `test-projects`). The value is the directory, with a trailing
 * `/`. The root `vite.config.ts` excludes the same directories from the `repo` project.
 */
export const OTHER_TEST_RUNNERS: ExceptionList = {
  max: 2,
  entries: [
    {
      value: 'tests/acceptance/',
      reason: 'Stage acceptance suites run with `vp run test:acceptance` (arrives in v0.1).',
    },
    {
      value: 'tests/conformance/',
      reason: 'The MCP conformance suite runs with `vp run test:conformance` (arrives in v0.1).',
    },
  ],
}

/** Every list, by name, for the meta-test that keeps them honest. */
export const EXCEPTION_LISTS: Readonly<Record<string, ExceptionList>> = {
  MISSING_DOC_PATHS,
  ZIZMOR_IGNORES,
  OTHER_TEST_RUNNERS,
}

export function exceptionValues(list: ExceptionList): string[] {
  return list.entries.map((entry) => entry.value)
}
