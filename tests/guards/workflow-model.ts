import { isMap, isScalar, isSeq, mapEntry, plain, readYaml, scalarString } from '../support/yaml.ts'
import { isRecord, isStringArray } from '../support/values.ts'
import type { TextFile } from './types.ts'

export interface UsesRef {
  value: string
  comment: string | undefined
  line: number
}

export interface WorkflowStep {
  index: number
  name: string | undefined
  condition: unknown
  uses: UsesRef | undefined
  inputs: Record<string, unknown>
  env: Record<string, unknown>
  run: string | undefined
}

export interface WorkflowJob {
  id: string
  startLine: number
  endLine: number
  needs: string[]
  condition: unknown
  concurrency: unknown
  hasPermissions: boolean
  permissions: unknown
  environment: unknown
  uses: UsesRef | undefined
  steps: WorkflowStep[]
}

export interface Workflow {
  path: string
  file: string
  errors: string[]
  hasPermissions: boolean
  permissions: unknown
  topLevelKeys: string[]
  triggers: unknown
  concurrency: unknown
  jobs: WorkflowJob[]
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function parseWorkflow(file: TextFile): Workflow {
  const yaml = readYaml(file.text)
  const workflow: Workflow = {
    path: file.path,
    file: fileName(file.path),
    errors: [...yaml.errors],
    hasPermissions: false,
    permissions: undefined,
    topLevelKeys: [],
    triggers: undefined,
    concurrency: undefined,
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
  workflow.triggers = plain(mapEntry(root, 'on')?.value)
  workflow.concurrency = plain(mapEntry(root, 'concurrency')?.value)

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
          const env = plain(mapEntry(stepNode, 'env')?.value)
          steps.push({
            index,
            name: scalarString(mapEntry(stepNode, 'name')?.value),
            condition: plain(mapEntry(stepNode, 'if')?.value),
            uses: usesOf(stepNode),
            inputs: isRecord(inputs) ? inputs : {},
            env: isRecord(env) ? env : {},
            run: scalarString(mapEntry(stepNode, 'run')?.value),
          })
        }
      }
      const jobPermissions = mapEntry(job, 'permissions')
      const needs = plain(mapEntry(job, 'needs')?.value)
      const keyStart = isScalar(jobPair.key) ? (jobPair.key.range?.[0] ?? 0) : 0
      const bodyEnd = job.range?.[1] ?? keyStart + 1
      workflow.jobs.push({
        id,
        startLine: yaml.lineOf(keyStart),
        endLine: yaml.lineOf(Math.max(bodyEnd - 1, keyStart)),
        needs: typeof needs === 'string' ? [needs] : isStringArray(needs) ? needs : [],
        condition: plain(mapEntry(job, 'if')?.value),
        concurrency: plain(mapEntry(job, 'concurrency')?.value),
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

export function actionRepository(uses: string): string {
  const [path = ''] = uses.split('@')
  return path.split('/').slice(0, 2).join('/')
}

export function describeStep(job: string, step: WorkflowStep): string {
  const name = step.name === undefined ? '' : ` "${step.name}"`
  return `job "${job}", step ${step.index + 1}${name}`
}
