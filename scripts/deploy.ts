/**
 * Our deployments (ADR-034): the Workers of this repository, built and deployed in an order, with
 * the migrations before the Worker that needs them and probes after, for one target:
 *
 *   node scripts/deploy.ts --target staging | production [--dry-run]
 *
 * `deploy.yml` runs it, staging on a push to `main` and production on a push to `release`, in the
 * environment `deploy` that holds the Cloudflare token; the maintainer may run it by hand. It
 * needs `CLOUDFLARE_ACCOUNT_ID` and wrangler logged in or `CLOUDFLARE_API_TOKEN`. A probe that
 * fails fails the run: the previous versions stay, to roll back to with `wrangler rollback`.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type Target = 'staging' | 'production'

/** A command, in a directory of the repository, with the variables it needs besides the runner's. */
export interface Step {
  readonly name: string
  readonly cwd: string
  readonly command: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  /** Instead of a command: keep the files of the live version in the build about to replace it. */
  readonly keep?: Keep
}

/**
 * The hashed files of a site, which a page loaded before a deploy still asks for after it: the
 * directory of the build (`dir`, its `prefix` inside it, as the site serves it) and the site's URL.
 */
export interface Keep {
  readonly dir: string
  readonly prefix: string
  readonly url: string
}

/** The list of a build's own hashed files, served next to them, which the next deploy reads. */
export const FILES = '_files.json'

/** A file name of a build: no directory, nothing a list could use to write elsewhere. */
const FILE_NAME = /^[\w-][\w.-]*$/

/**
 * Keeps the previous version of a site working while the next one goes live: a page loaded before
 * the deploy asks for its own hashed files (the admin's pages, a Nuxt site's chunks), which a
 * deploy of assets would remove. The files the live version lists that the new build lacks are
 * copied into the build, so they are deployed with it; the build then lists its own files only, so
 * a file is kept for one deploy and no longer. A site with no list yet (its first deploy with
 * this) keeps nothing.
 */
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
  /** What must answer 200, again and again, once every step is done. */
  readonly probes: readonly string[]
}

const VP = './node_modules/.bin/vp'
const WRANGLER = './node_modules/.bin/wrangler'
const NUXT = './node_modules/.bin/nuxt'
const CLI = ['node', '../../packages/cli/src/index.ts']

/** The public URL of the CMS of each target. */
const CMS_URL = {
  staging: 'https://hollware-staging.sergioazoc.workers.dev',
  demo: 'https://cms.demo.hollware.com',
} as const

/** The step that keeps the live files of a site in its new build (`keepLive`). */
function keepStep(what: string, keep: Keep): Step {
  return { name: `keep the files of the live ${what}`, cwd: '.', command: [], keep }
}

/** The Hollware of a target: build it, keep the live admin's files, migrate, deploy it. */
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

/** The agents of a target, which the CMS wakes over its service binding. */
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

/** The Hollware whose public URL counts the views of our sites (ADR-031). */
const BEACON = 'https://cms.demo.hollware.com'

/**
 * The packages, built first: the CMS takes the admin from the build of @hollware/admin, which a
 * fresh checkout does not have. Without it the CMS deploys with no admin, and /admin/ is a 404.
 */
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
        env: { HOLLWARE_BEACON: BEACON },
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
        env: { HOLLWARE_BEACON: BEACON },
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

/** How a probe judges a deploy: this many answers of 200 in a row, one a second, within the budget. */
export const PROBE = { inARow: 30, budgetSeconds: 180 } as const

/** Whether a URL answered 200 `inARow` times in a row within the budget, as `fetch` sees it. */
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
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...step.env },
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
