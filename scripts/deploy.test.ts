import { describe, expect, it } from 'vite-plus/test'

import { planOf, probe } from './deploy.ts'

// Fails when: a deployment of ours (scripts/deploy.ts, ADR-034) stops building the packages first
// (the CMS takes the admin from their build), stops migrating a database before
// the Worker that reads it is deployed, deploys a site before the CMS it reads, builds a Worker
// for another environment than its own, or stops probing what it deployed, the admin included; or a probe passes a
// URL that did not answer 200 thirty times in a row, or fails one that did within its budget.

const names = (target: 'staging' | 'production') => planOf(target).steps.map((step) => step.name)

describe('the plan of a deployment', () => {
  it('migrates before it deploys the CMS, and deploys the CMS before the sites that read it', () => {
    expect(names('production')).toEqual([
      'build the packages',
      'build the CMS (demo)',
      'migrate the database of the CMS (demo)',
      'deploy the CMS (demo)',
      'build the agents (demo)',
      'deploy the agents (demo)',
      'build the demo blog',
      'deploy the demo blog',
      'build hollware.com',
      'deploy hollware.com',
    ])
    expect(names('staging')).toEqual([
      'build the packages',
      'build the CMS (staging)',
      'migrate the database of the CMS (staging)',
      'deploy the CMS (staging)',
      'build the agents (staging)',
      'deploy the agents (staging)',
    ])
  })

  it('builds and migrates each Worker in its own environment, and probes what it deployed', () => {
    for (const target of ['staging', 'production'] as const) {
      const environment = target === 'staging' ? 'staging' : 'demo'
      const cms = planOf(target).steps.filter(
        (step) => step.cwd === 'apps/playground' && step.env !== undefined,
      )
      expect(cms.map((step) => step.env?.['CLOUDFLARE_ENV'])).toEqual([environment, environment])
    }
    expect(planOf('production').probes).toContain('https://hollware.com/')
    // The admin, which the CMS takes from the build of the packages: a deploy without it is a 404.
    expect(planOf('production').probes).toContain('https://cms.demo.hollware.com/admin/')
    expect(planOf('staging').probes).toEqual([
      'https://hollware-staging.sergioazoc.workers.dev/health',
      'https://hollware-staging.sergioazoc.workers.dev/admin/',
    ])
  })
})

describe('probe', () => {
  const run = (statuses: number[], limits = { inARow: 3, budgetSeconds: 6 }) => {
    let call = 0
    return probe(
      'https://x.test/',
      async () => statuses[call++] ?? 0,
      async () => undefined,
      limits,
    )
  }

  it('passes three answers of 200 in a row, after a failure, within the budget', async () => {
    expect(await run([500, 200, 200, 200])).toBe(true)
  })

  it('fails a streak that a failure breaks, or one the budget does not hold', async () => {
    expect(await run([200, 200, 503, 200, 200, 500])).toBe(false)
    expect(await run([200, 200], { inARow: 3, budgetSeconds: 2 })).toBe(false)
  })
})
