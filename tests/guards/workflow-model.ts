import { isMap, isScalar, isSeq, mapEntry, plain, readYaml, scalarString } from '../support/yaml.ts'
import { isRecord } from '../support/values.ts'
import type { TextFile } from './types.ts'

/** A `uses:` reference, with the comment that follows it. */
export interface UsesRef {
  /** The text after `uses:`, e.g. `actions/checkout@3d3c...`. */
  value: string
  /** The trailing `# comment` of the line, without the `#`. */
  comment: string | undefined
  /** 1-based line of the reference. */
  line: number
}

export interface WorkflowStep {
  /** 0-based position in the job. */
  index: number
  name: string | undefined
  uses: UsesRef | undefined
  /** The `with:` inputs. Empty when there are none. */
  inputs: Record<string, unknown>
}

export interface WorkflowJob {
  id: string
  /** `if:` of the job, as written. */
  condition: unknown
  /** Whether the job has a `permissions:` key at all. */
  hasPermissions: boolean
  permissions: unknown
  environment: unknown
  /** `uses:` of a job that calls a reusable workflow. */
  uses: UsesRef | undefined
  steps: WorkflowStep[]
}

export interface Workflow {
  path: string
  /** The file name, e.g. `release.yml`. */
  file: string
  /** YAML errors. A workflow with errors cannot be judged. */
  errors: string[]
  hasPermissions: boolean
  /** The top-level `permissions:` value. */
  permissions: unknown
  /** The top-level keys, in file order. */
  topLevelKeys: string[]
  jobs: WorkflowJob[]
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Reads a workflow into the parts the guards look at. */
export function parseWorkflow(file: TextFile): Workflow {
  const yaml = readYaml(file.text)
  const workflow: Workflow = {
    path: file.path,
    file: fileName(file.path),
    errors: [...yaml.errors],
    hasPermissions: false,
    permissions: undefined,
    topLevelKeys: [],
    jobs: [],
  }
  if (yaml.hasAliases) {
    workflow.errors.push('YAML aliases hide steps from the guards: write each step out')
  }
  const root = yaml.doc.contents
  if (!isMap(root)) {
    if (workflow.errors.length === 0) workflow.errors.push('a workflow must be a YAML mapping')
    return workflow
  }

  const usesOf = (node: unknown): UsesRef | undefined => {
    if (!isMap(node)) return undefined
    const entry = mapEntry(node, 'uses')
    const value = scalarString(entry?.value)
    if (entry === undefined || value === undefined || !isScalar(entry.value)) return undefined
    return {
      value,
      comment: yaml.trailingComment(entry.value),
      line: yaml.lineOf(entry.value.range?.[0] ?? 0),
    }
  }

  workflow.topLevelKeys = root.items.flatMap((pair) => {
    const key = scalarString(pair.key)
    return key === undefined ? [] : [key]
  })

  const permissions = mapEntry(root, 'permissions')
  workflow.hasPermissions = permissions !== undefined
  workflow.permissions = permissions === undefined ? undefined : plain(permissions.value)

  const jobs = mapEntry(root, 'jobs')?.value
  if (isMap(jobs)) {
    for (const jobPair of jobs.items) {
      const id = scalarString(jobPair.key)
      if (id === undefined || !isMap(jobPair.value)) continue
      const job = jobPair.value
      const steps: WorkflowStep[] = []
      const stepsNode = mapEntry(job, 'steps')?.value
      if (isSeq(stepsNode)) {
        for (const [index, stepNode] of stepsNode.items.entries()) {
          if (!isMap(stepNode)) continue
          const inputs = plain(mapEntry(stepNode, 'with')?.value)
          steps.push({
            index,
            name: scalarString(mapEntry(stepNode, 'name')?.value),
            uses: usesOf(stepNode),
            inputs: isRecord(inputs) ? inputs : {},
          })
        }
      }
      const jobPermissions = mapEntry(job, 'permissions')
      workflow.jobs.push({
        id,
        condition: plain(mapEntry(job, 'if')?.value),
        hasPermissions: jobPermissions !== undefined,
        permissions: jobPermissions === undefined ? undefined : plain(jobPermissions.value),
        environment: plain(mapEntry(job, 'environment')?.value),
        uses: usesOf(job),
        steps,
      })
    }
  }
  return workflow
}

/** Every `uses:` of the workflow, jobs and steps, with the job and step it sits in. */
export function allUses(
  workflow: Workflow,
): { ref: UsesRef; job: string; step: WorkflowStep | undefined }[] {
  const found: { ref: UsesRef; job: string; step: WorkflowStep | undefined }[] = []
  for (const job of workflow.jobs) {
    if (job.uses !== undefined) found.push({ ref: job.uses, job: job.id, step: undefined })
    for (const step of job.steps) {
      if (step.uses !== undefined) found.push({ ref: step.uses, job: job.id, step })
    }
  }
  return found
}

/** The `owner/repo` of a `uses:` value, e.g. `changesets/action` for `changesets/action/pack@...`. */
export function actionRepository(uses: string): string {
  const [path = ''] = uses.split('@')
  return path.split('/').slice(0, 2).join('/')
}

/** A human name for a step: `job "stage", step 3 "Set up Node.js"`. */
export function describeStep(job: string, step: WorkflowStep): string {
  const name = step.name === undefined ? '' : ` "${step.name}"`
  return `job "${job}", step ${step.index + 1}${name}`
}
