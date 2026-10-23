import { spawnSync } from 'node:child_process'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type Target = 'staging' | 'production'

export interface Step {
  readonly name: string
  readonly cwd: string
  readonly command: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly keep?: Keep
}

export interface Keep {
  readonly dir: string
  readonly prefix: string
  readonly url: string
}

export const FILES = '_files.json'

const FILE_NAME = /^[\w-][\w.-]*$/

export async function keepLive(
  root: string,
  keep: Keep,
  fetcher: (url: string) => Promise<Response>,
): Promise<number> {
  const dir = resolve(root, keep.dir, keep.prefix)
  const own = readdirSync(dir)
    .filter((name) => name !== FILES && statSync(join(dir, name)).isFile())
    .sort()
  const base = `${keep.url}/${keep.prefix}`
  const listed = await fetcher(`${base}/${FILES}`)
  const live: unknown = listed.ok ? await listed.json().catch(() => []) : []
  let kept = 0
  for (const name of Array.isArray(live) ? live : []) {
    if (typeof name !== 'string' || !FILE_NAME.test(name) || own.includes(name)) continue
    const file = await fetcher(`${base}/${name}`)
    if (!file.ok) continue
    writeFileSync(join(dir, name), new Uint8Array(await file.arrayBuffer()))
    kept++
  }
  writeFileSync(join(dir, FILES), JSON.stringify(own))
  return kept
}

export interface Plan {
  readonly steps: readonly Step[]
  readonly probes: readonly string[]
}

const VP = './node_modules/.bin/vp'
const WRANGLER = './node_modules/.bin/wrangler'
const NUXT = './node_modules/.bin/nuxt'
const CLI = ['node', '../../packages/cli/src/index.ts']

const CMS_URL = {
  staging: 'https://hollware-staging.sergioazoc.workers.dev',
  demo: 'https://cms.demo.hollware.com',
} as const

function keepStep(what: string, keep: Keep): Step {
  return { name: `keep the files of the live ${what}`, cwd: '.', command: [], keep }
}

function cms(env: 'staging' | 'demo'): Step[] {
  const vars = { CLOUDFLARE_ENV: env }
  return [
    { name: `build the CMS (${env})`, cwd: 'apps/playground', command: [VP, 'build'], env: vars },
    keepStep(`admin (${env})`, {
      dir: 'apps/playground/dist/client',
      prefix: 'admin/assets',
      url: CMS_URL[env],
    }),
    {
      name: `migrate the database of the CMS (${env})`,
      cwd: 'apps/playground',
      command: [...CLI, 'migrate', '--remote'],
      env: vars,
    },
    {
      name: `deploy the CMS (${env})`,
      cwd: 'apps/playground',
      command: [WRANGLER, 'deploy', '-c', 'dist/hollware_playground/wrangler.json'],
    },
  ]
}

function agents(env: 'staging' | 'demo'): Step[] {
  return [
    {
      name: `build the agents (${env})`,
      cwd: 'examples/agents-worker',
      command: [VP, 'build'],
      env: { CLOUDFLARE_ENV: env },
    },
    {
      name: `deploy the agents (${env})`,
      cwd: 'examples/agents-worker',
      command: [WRANGLER, 'deploy', '-c', 'dist/hollware_agents/wrangler.json'],
    },
  ]
}

const PACKAGES: Step = { name: 'build the packages', cwd: '.', command: [VP, 'run', '-r', 'build'] }

export function planOf(target: Target): Plan {
  if (target === 'staging') {
    return {
      steps: [PACKAGES, ...cms('staging'), ...agents('staging')],
      probes: [
        'https://hollware-staging.sergioazoc.workers.dev/health',
        'https://hollware-staging.sergioazoc.workers.dev/admin/',
      ],
    }
  }
  return {
    steps: [
      PACKAGES,
      ...cms('demo'),
      ...agents('demo'),
      {
        name: 'build the demo blog',
        cwd: 'examples/nuxt-blog',
        command: [NUXT, 'build'],
      },
      keepStep('demo blog', {
        dir: 'examples/nuxt-blog/.output/public',
        prefix: '_nuxt',
        url: 'https://demo.hollware.com',
      }),
      {
        name: 'deploy the demo blog',
        cwd: 'examples/nuxt-blog',
        command: [WRANGLER, 'deploy', '-c', '.output/server/wrangler.json', '--env', 'demo'],
      },
      {
        name: 'build hollware.com',
        cwd: 'apps/web',
        command: [NUXT, 'build'],
      },
      keepStep('hollware.com', {
        dir: 'apps/web/.output/public',
        prefix: '_nuxt',
        url: 'https://hollware.com',
      }),
      {
        name: 'deploy hollware.com',
        cwd: 'apps/web',
        command: [WRANGLER, 'deploy', '-c', '.output/server/wrangler.json', '--env', 'production'],
      },
    ],
    probes: [
      'https://cms.demo.hollware.com/health',
      'https://cms.demo.hollware.com/admin/',
      'https://demo.hollware.com/',
      'https://hollware.com/',
      'https://hollware.com/docs/quickstart/',
    ],
  }
}

export const PROBE = { inARow: 30, budgetSeconds: 180 } as const

export async function probe(
  url: string,
  fetcher: (url: string) => Promise<number>,
  wait: (ms: number) => Promise<void>,
  limits: { readonly inARow: number; readonly budgetSeconds: number } = PROBE,
): Promise<boolean> {
  let streak = 0
  for (let second = 0; second < limits.budgetSeconds; second++) {
    const status = await fetcher(url).catch(() => 0)
    streak = status === 200 ? streak + 1 : 0
    if (streak >= limits.inARow) return true
    await wait(1000)
  }
  return false
}

export async function main(root: string, argv: readonly string[]): Promise<number> {
  const at = argv.indexOf('--target')
  const target = argv[at + 1]
  if (at === -1 || (target !== 'staging' && target !== 'production')) {
    console.error('Usage: node scripts/deploy.ts --target staging | production [--dry-run]')
    return 2
  }
  const plan = planOf(target)
  for (const step of plan.steps) {
    console.log(`▸ ${step.name}`)
    if (argv.includes('--dry-run')) continue
    if (step.keep !== undefined) {
      console.log(`  kept ${await keepLive(root, step.keep, (url) => fetch(url))} files`)
      continue
    }
    const [command = '', ...args] = step.command
    const run = spawnSync(command, args, {
      cwd: resolve(root, step.cwd),
      env: envOf(step, process.env),
      stdio: 'inherit',
    })
    if (run.status !== 0) {
      console.error(`✘ ${step.name} failed (${run.status ?? run.signal})`)
      return 1
    }
  }
  if (argv.includes('--dry-run')) return 0
  const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
  const fetcher = async (url: string) => (await fetch(url, { redirect: 'manual' })).status
  const results = await Promise.all(
    plan.probes.map(async (url) => [url, await probe(url, fetcher, wait)] as const),
  )
  for (const [url, ok] of results) console.log(`${ok ? '✔' : '✘'} ${url}`)
  return results.every(([, ok]) => ok) ? 0 : 1
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  main(resolve(import.meta.dirname, '..'), process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}

export function needsAccount(step: Step): boolean {
  return /^(migrate|deploy) /.test(step.name)
}

export function envOf(step: Step, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...env, WRANGLER_SEND_METRICS: 'false', ...step.env }
  if (!needsAccount(step)) delete base['CLOUDFLARE_API_TOKEN']
  return base
}
