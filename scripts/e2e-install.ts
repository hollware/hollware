/**
 * The install, end to end, as a user does it (AC-0.4-1):
 *
 *   node scripts/e2e-install.ts [--pm npm|pnpm]
 *
 * It packs this checkout's published packages at a version of its own, serves them from a local
 * registry that sends everything else to npm (scripts/e2e/registry.ts), and in an empty directory
 * runs `create-hollware` from that registry. Then, in the project it made:
 *
 * 1. the dev server starts and answers `/health`;
 * 2. MCP lists every tool (`OPERATIONS` of @hollware/core) to the token that create-hollware printed;
 * 3. that token creates a draft and publishes it;
 * 4. a read token, made with the project's own `hollware`, reads the published entry over `/v1`,
 *    and is refused by MCP;
 * 5. `hollware doctor` finds nothing to fix.
 *
 * It needs the network (npm) and port 5199. Exits 0 when every step passed.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { OPERATIONS } from '../packages/core/src/index.ts'
import { packAll } from './e2e/pack.ts'
import {
  call,
  fail,
  mcp,
  PROJECT_URL,
  publishPost,
  readPublished,
  run,
  startDev,
  step,
} from './e2e/project.ts'
import { startRegistry } from './e2e/registry.ts'

const ROOT = resolve(import.meta.dirname, '..')

/** The environment of a user whose package manager reads from the local registry. */
export function userEnv(registry: string, work: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // npm reads npm_config_*, and pnpm 12 only pnpm_config_*.
    npm_config_registry: registry,
    pnpm_config_registry: registry,
    npm_config_cache: join(work, 'npm-cache'),
    pnpm_config_store_dir: join(work, 'pnpm-store'),
    pnpm_config_cache_dir: join(work, 'pnpm-cache'),
    npm_config_update_notifier: 'false',
    WRANGLER_SEND_METRICS: 'false',
  }
}

/** The version of this checkout's packages in a test: its own, so that npm has none like it. */
export function e2eVersion(): string {
  const core: { version: string } = JSON.parse(
    readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8'),
  )
  return `${core.version}-e2e.${Date.now()}`
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { pm: { type: 'string', default: 'npm' } } })
  const pm = values.pm === 'pnpm' ? 'pnpm' : 'npm'
  const work = mkdtempSync(join(tmpdir(), 'hollware-e2e-install-'))
  const version = e2eVersion()
  let stopDev: (() => void) | undefined
  let close: (() => Promise<void>) | undefined
  try {
    step(`Packing the published packages at ${version}`)
    const registry = await startRegistry(packAll(ROOT, version, join(work, 'tarballs')))
    close = () => registry.close()
    const env = userEnv(registry.url, work)

    step(`create-hollware@${version} with ${pm}, from ${registry.url}`)
    const created =
      pm === 'pnpm'
        ? await run(
            'pnpm',
            ['dlx', `create-hollware@${version}`, 'my-cms', '--pm', 'pnpm', '--no-git'],
            work,
            env,
          )
        : await run(
            'npm',
            [
              'exec',
              '--yes',
              '--package',
              `create-hollware@${version}`,
              '--',
              'create-hollware',
              'my-cms',
              '--no-git',
            ],
            work,
            env,
          )
    process.stdout.write(created.replace(/hw_pat_[0-9a-z]{52}/g, 'hw_pat_<hidden>'))
    const token =
      /hw_pat_[0-9a-hjkmnp-tv-z]{52}/.exec(created)?.[0] ?? fail('create-hollware printed no token')
    if (!created.includes(`claude mcp add --transport http hollware ${PROJECT_URL}/mcp`)) {
      fail('create-hollware printed no claude mcp add line')
    }
    const project = join(work, 'my-cms')
    const installed: { version: string } = JSON.parse(
      readFileSync(join(project, 'node_modules/@hollware/server/package.json'), 'utf8'),
    )
    if (installed.version !== version) {
      fail(`the project installed @hollware/server ${installed.version}`)
    }

    step('The project passes its own checks, as it was made')
    for (const script of ['check', 'test', 'types:check']) {
      process.stdout.write(await run(pm, ['run', script], project, env))
    }

    // `hollware deploy` writes the public URL into wrangler.jsonc: the project's tests still pass,
    // and its dev server still answers at localhost (vite.config.ts), up to the read token below.
    step('Its tests pass once wrangler.jsonc names a public URL, as after a deploy')
    const config = join(project, 'wrangler.jsonc')
    const local = readFileSync(config, 'utf8')
    writeFileSync(
      config,
      local.replace(
        '"HOLLWARE_PUBLIC_URL": "http://localhost:5199"',
        '"HOLLWARE_PUBLIC_URL": "https://cms.example.com"',
      ),
    )
    if (readFileSync(config, 'utf8') === local) fail('wrangler.jsonc has no localhost public URL')
    process.stdout.write(await run(pm, ['run', 'test'], project, env))

    step('The dev server')
    stopDev = (await startDev(project, env)).stop

    step('MCP lists every tool to the token of create-hollware')
    const listed = await mcp(token, 'tools/list', {})
    const tools = (listed['tools'] as { name: string }[]).map((tool) => tool.name)
    if (tools.length !== OPERATIONS.length)
      fail(`tools/list answered ${tools.length} tools: ${tools.join(', ')}`)

    step('A draft, published')
    await publishPost(token, 'written-in-the-install-test', 'Written in the install test')

    step('An image, uploaded over MCP and served as WebP')
    const pixel =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
    const uploaded = await call(token, 'upload_asset', {
      filename: 'pixel.png',
      alt: 'One red pixel',
      data: pixel,
    })
    const asset = uploaded['asset'] as { url: string; format: string } | undefined
    if (uploaded['outcome'] !== 'created' || asset === undefined) {
      fail(`upload_asset answered ${JSON.stringify(uploaded)}`)
    }
    const image = await fetch(asset.url)
    const served = new Uint8Array(await image.arrayBuffer())
    const isWebp = new TextDecoder().decode(served.subarray(8, 12)) === 'WEBP'
    if (image.status !== 200 || asset.format !== 'image/webp' || !isWebp) {
      fail(`the image was served ${image.status} as ${asset.format}, not as WebP`)
    }

    step('A read token reads it over /v1, and is refused by MCP')
    const hollware = join(project, 'node_modules/.bin/hollware')
    const made = await run(
      hollware,
      ['token', 'create', '--read', '--label', 'e2e', '--local'],
      project,
      env,
    )
    const reader =
      /hw_read_[0-9a-hjkmnp-tv-z]{52}/.exec(made)?.[0] ??
      fail('token create --read printed no token')
    const read = await readPublished(reader, 'written-in-the-install-test')
    if (read !== 200) fail(`the read token read ${read}`)
    const refused = await fetch(`${PROJECT_URL}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${reader}`, 'content-type': 'application/json' },
      body: '{}',
    })
    if (refused.status !== 403) fail(`MCP answered a read token with ${refused.status}`)

    writeFileSync(config, local)

    step('hollware doctor')
    process.stdout.write(await run(hollware, ['doctor'], project, env))

    step(`The install works, with ${pm}.`)
  } finally {
    stopDev?.()
    await close?.()
    rmSync(work, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `\ne2e-install failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
