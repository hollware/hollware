import type { TextFile, Violation } from './types.ts'
import { parseWorkflow } from './workflow-model.ts'

export interface WorkflowForbiddenInput {
  files: readonly TextFile[]
  zizmorIgnores: readonly string[]
  zizmorConfigs: readonly string[]
}

export const PUBLISH_FILE = '.github/workflows/release.yml'
export const PUBLISH_JOB = 'publish'

const FORBIDDEN: readonly { rule: string; pattern: RegExp; what: string }[] = [
  {
    rule: 'npm-token',
    pattern: /\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b/,
    what: 'an npm token: publishing is OIDC trusted publishing',
  },
  {
    rule: 'publish',
    pattern: /\b(?:pnpm|yarn)\s+(?:-\S+\s+)*publish\b|\bchangeset\s+publish\b|\bnpm\s+stage\b/,
    what: `a publish that is not "npm publish --provenance" in the "${PUBLISH_JOB}" job of ${PUBLISH_FILE}`,
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

const NPM_PUBLISH = /\bnpm\s+(?:-\S+\s+)*publish\b/
const PROVENANCE = /(?:^|\s)--provenance(?=\s|$)/
const ZIZMOR_IGNORE = /zizmor:\s*ignore(?:\[[^\]]*\])?/g

function publishJobLines(file: TextFile): { start: number; end: number } | undefined {
  if (file.path !== PUBLISH_FILE) return undefined
  const workflow = parseWorkflow(file)
  if (workflow.errors.length > 0) return undefined
  const job = workflow.jobs.find((candidate) => candidate.id === PUBLISH_JOB)
  return job === undefined ? undefined : { start: job.startLine, end: job.endLine }
}

export function checkWorkflowForbidden(input: WorkflowForbiddenInput): Violation[] {
  const violations: Violation[] = []
  const remaining = [...input.zizmorIgnores]
  for (const file of input.files) {
    const publishJob = publishJobLines(file)
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
      const publish = NPM_PUBLISH.exec(line)
      if (publish !== null) {
        const inPublishJob =
          publishJob !== undefined && index + 1 >= publishJob.start && index + 1 <= publishJob.end
        if (!inPublishJob) {
          violations.push({
            rule: 'workflow-forbidden/publish',
            file: file.path,
            message: `line ${index + 1} has "${publish[0].trim()}": npm publish belongs in the "${PUBLISH_JOB}" job of ${PUBLISH_FILE} and nowhere else`,
          })
        } else if (!PROVENANCE.test(line)) {
          violations.push({
            rule: 'workflow-forbidden/provenance',
            file: file.path,
            message: `line ${index + 1} has "${publish[0].trim()}" without --provenance on the same line: every release carries its provenance attestation`,
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
