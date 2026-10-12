import type { TextFile, Violation } from './types.ts'
import { actionRepository, allUses, parseWorkflow } from './workflow-model.ts'

/**
 * Guard `workflow-pinning`: every `uses:` of every workflow is
 * `owner/repo[/subpath]@<40-character commit SHA> # vX.Y.Z`. A tag or a branch can be moved
 * after review, a commit cannot; the comment says which release the commit is. An action used
 * in several places is pinned to the same commit with the same comment everywhere, because
 * bumping an action replaces them all at once (`.github/AGENTS.md`). Local actions and
 * `docker://` images are not accepted: nothing pins them.
 */

export interface WorkflowPinningInput {
  /** The `.github/workflows/*.yml` files. */
  workflows: readonly TextFile[]
}

const USES = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?)@([0-9a-f]{40})$/
const VERSION_COMMENT = /^v\d+\.\d+\.\d+$/

export function checkWorkflowPinning(input: WorkflowPinningInput): Violation[] {
  const violations: Violation[] = []
  const seen = new Map<string, { sha: string; comment: string; where: string }>()
  for (const file of input.workflows) {
    const workflow = parseWorkflow(file)
    for (const error of workflow.errors) {
      violations.push({
        rule: 'workflow-pinning/yaml-error',
        file: file.path,
        message: `the workflow cannot be checked: ${error}`,
      })
    }
    for (const { ref } of allUses(workflow)) {
      const match = USES.exec(ref.value)
      if (match === null) {
        violations.push({
          rule: 'workflow-pinning/unpinned',
          file: file.path,
          message: `line ${ref.line}: "uses: ${ref.value}" must be owner/repo[/subpath]@<40-character commit SHA>, never a tag, a branch, a local path or an image`,
        })
        continue
      }
      const sha = match[2] ?? ''
      if (ref.comment === undefined || !VERSION_COMMENT.test(ref.comment)) {
        violations.push({
          rule: 'workflow-pinning/version-comment',
          file: file.path,
          message: `line ${ref.line}: "uses: ${ref.value}" needs a trailing "# vX.Y.Z" comment with the release of that commit, found ${ref.comment === undefined ? 'none' : `"# ${ref.comment}"`}`,
        })
        continue
      }
      const repository = actionRepository(ref.value)
      const before = seen.get(repository)
      if (before === undefined) {
        seen.set(repository, { sha, comment: ref.comment, where: `${file.path}:${ref.line}` })
      } else if (before.sha !== sha || before.comment !== ref.comment) {
        violations.push({
          rule: 'workflow-pinning/inconsistent',
          file: file.path,
          message: `line ${ref.line}: ${repository} is pinned to ${sha} (${ref.comment}) here and to ${before.sha} (${before.comment}) at ${before.where}: bump an action everywhere at once`,
        })
      }
    }
  }
  return violations
}
