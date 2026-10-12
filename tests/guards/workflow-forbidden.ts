import type { TextFile, Violation } from './types.ts'

/**
 * Guard `workflow-forbidden`: nothing in a workflow or a workflow script can publish with a
 * token or run code nobody pinned.
 *
 * Forbidden in `.github/workflows/*.yml` and `.github/scripts/*`: `NPM_TOKEN` and
 * `NODE_AUTH_TOKEN` (publishing is OIDC trusted publishing), `npm publish`, `pnpm publish`,
 * `yarn publish` and `changeset publish` (only `npm stage publish` publishes), `git push`
 * (nothing pushes with git credentials; the API does), `npx`, `pnpx`, `bunx` and `dlx` (a
 * command fetched at run time is not the one in the lockfile).
 *
 * `zizmor: ignore[...]` comments switch off a finding of the workflow linter. Each one must be
 * in the allowlist, which may only shrink, and so must be no zizmor config file, which would
 * switch findings off out of sight. The scan reads raw text, comments included, and never
 * reads `.github/AGENTS.md`, which has to name these words to forbid them.
 */

export interface WorkflowForbiddenInput {
  /** `.github/workflows/*.yml` and `.github/scripts/*`. */
  files: readonly TextFile[]
  /** Allowed ignores, as `<file>#<directive>`. */
  zizmorIgnores: readonly string[]
  /** Tracked files that configure zizmor (`zizmor.yml`, `.github/zizmor.yml`, ...). */
  zizmorConfigs: readonly string[]
}

const FORBIDDEN: readonly { rule: string; pattern: RegExp; what: string }[] = [
  {
    rule: 'npm-token',
    pattern: /\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b/,
    what: 'an npm token: publishing is OIDC trusted publishing',
  },
  {
    rule: 'publish',
    pattern: /\b(?:npm|pnpm|yarn)\s+(?:-\S+\s+)*publish\b|\bchangeset\s+publish\b/,
    what: 'a direct publish: only "npm stage publish" publishes',
  },
  {
    rule: 'git-push',
    pattern: /\bgit\s+push\b/,
    what: 'a push with git credentials: nothing pushes from a workflow with git',
  },
  {
    rule: 'npx',
    pattern: /\b(?:npx|pnpx|bunx)(?:\s|$)/,
    what: 'an unpinned command runner: run the version in the lockfile',
  },
  {
    rule: 'dlx',
    pattern: /\bdlx\b/,
    what: 'an unpinned command runner: run the version in the lockfile',
  },
]

const ZIZMOR_IGNORE = /zizmor:\s*ignore(?:\[[^\]]*\])?/g

export function checkWorkflowForbidden(input: WorkflowForbiddenInput): Violation[] {
  const violations: Violation[] = []
  const remaining = [...input.zizmorIgnores]
  for (const file of input.files) {
    for (const [index, line] of file.text.split('\n').entries()) {
      for (const { rule, pattern, what } of FORBIDDEN) {
        const found = pattern.exec(line)
        if (found !== null) {
          violations.push({
            rule: `workflow-forbidden/${rule}`,
            file: file.path,
            message: `line ${index + 1} has "${found[0].trim()}": ${what}`,
          })
        }
      }
      for (const directive of line.matchAll(ZIZMOR_IGNORE)) {
        const normalized = directive[0].replace(/\s+/g, ' ')
        const key = `${file.path}#${normalized}`
        const allowed = remaining.indexOf(key)
        if (allowed === -1) {
          violations.push({
            rule: 'workflow-forbidden/zizmor-ignore',
            file: file.path,
            message: `line ${index + 1} has "${normalized}", which is not in the allowlist: fix the finding instead of silencing it`,
          })
        } else {
          remaining.splice(allowed, 1)
        }
      }
    }
  }
  for (const config of input.zizmorConfigs) {
    violations.push({
      rule: 'workflow-forbidden/zizmor-config',
      file: config,
      message:
        'a zizmor config can switch findings off out of sight: delete it, and use an inline ignore that the allowlist counts',
    })
  }
  for (const key of remaining) {
    violations.push({
      rule: 'workflow-forbidden/stale-exception',
      file: 'tests/guards/exceptions.ts',
      message: `the allowed zizmor ignore "${key}" no longer exists: remove it from ZIZMOR_IGNORES and lower its max`,
    })
  }
  return violations
}
