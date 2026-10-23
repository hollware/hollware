import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { envOf, FILES, keepLive, planOf, probe } from './deploy.ts'

const names = (target: 'staging' | 'production') => planOf(target).steps.map((step) => step.name)

describe('the plan of a deployment', () => {
  it('migrates before it deploys the CMS, and deploys the CMS before the sites that read it', () => {
    expect(names('production')).toEqual([
      'build the packages',
      'build the CMS (demo)',
      'keep the files of the live admin (demo)',
      'migrate the database of the CMS (demo)',
      'deploy the CMS (demo)',
      'build the agents (demo)',
      'deploy the agents (demo)',
      'build the demo blog',
      'keep the files of the live demo blog',
      'deploy the demo blog',
      'build hollware.com',
      'keep the files of the live hollware.com',
      'deploy hollware.com',
    ])
    expect(names('staging')).toEqual([
      'build the packages',
      'build the CMS (staging)',
      'keep the files of the live admin (staging)',
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

describe('keepLive', () => {
  const site = (files: Record<string, string>) => {
    const asked: string[] = []
    const fetcher = async (url: string) => {
      asked.push(url)
      const name = url.slice('https://cms.test/admin/assets/'.length)
      const body = files[name]
      return body === undefined ? new Response('', { status: 404 }) : new Response(body)
    }
    return { asked, fetcher }
  }
  const build = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'keep-'))
    const dir = join(root, 'dist', 'admin', 'assets')
    mkdirSync(dir, { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
    return { root, dir }
  }
  const keep = { dir: 'dist', prefix: 'admin/assets', url: 'https://cms.test' }

  it('copies the live files the new build lacks, and lists the build own files only', async () => {
    const { root, dir } = build({ 'index-new.js': 'new', 'Entries-same.js': 'mine' })
    const live = site({
      [FILES]: JSON.stringify(['index-old.js', 'Entries-same.js', 'gone.js']),
      'index-old.js': 'old',
      'Entries-same.js': 'theirs',
    })

    expect(await keepLive(root, keep, live.fetcher)).toBe(1)
    expect(readdirSync(dir).sort()).toEqual([
      'Entries-same.js',
      FILES,
      'index-new.js',
      'index-old.js',
    ])
    expect(readFileSync(join(dir, 'index-old.js'), 'utf8')).toBe('old')
    expect(readFileSync(join(dir, 'Entries-same.js'), 'utf8')).toBe('mine')
    expect(JSON.parse(readFileSync(join(dir, FILES), 'utf8'))).toEqual([
      'Entries-same.js',
      'index-new.js',
    ])
  })

  it('keeps nothing from a site with no list, and nothing a list names outside the directory', async () => {
    const first = build({ 'index-new.js': 'new' })
    expect(await keepLive(first.root, keep, site({}).fetcher)).toBe(0)
    expect(readdirSync(first.dir).sort()).toEqual([FILES, 'index-new.js'].sort())

    const evil = build({ 'index-new.js': 'new' })
    const live = site({
      [FILES]: JSON.stringify(['../../escape.js', '.hidden', 'ok.js']),
      'ok.js': 'ok',
    })
    expect(await keepLive(evil.root, keep, live.fetcher)).toBe(1)
    expect(live.asked).not.toContain('https://cms.test/admin/assets/../../escape.js')
    expect(readdirSync(join(evil.root, 'dist'))).toEqual(['admin'])
  })
})

describe('the Cloudflare token', () => {
  it('reaches the steps that migrate or deploy, and no step that builds', () => {
    const env = { CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: 'acct', PATH: '/bin' }
    const holding = planOf('production').steps.filter(
      (step) => envOf(step, env)['CLOUDFLARE_API_TOKEN'] === 'cf-token',
    )

    expect(holding.map((step) => step.name)).toEqual([
      'migrate the database of the CMS (demo)',
      'deploy the CMS (demo)',
      'deploy the agents (demo)',
      'deploy the demo blog',
      'deploy hollware.com',
    ])
    const build = planOf('production').steps.find((step) => step.name === 'build the packages')
    expect(build === undefined ? null : envOf(build, env)).toEqual({
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      PATH: '/bin',
      WRANGLER_SEND_METRICS: 'false',
    })
  })
})
