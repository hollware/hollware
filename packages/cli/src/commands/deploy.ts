import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFlags } from '../args.ts'
import { query, resolveDatabase } from '../d1.ts'
import { CliError } from '../errors.ts'
import type { Io } from '../io.ts'
import { publicUrlOf } from '../public-url.ts'
import { ownerQuery } from '../sql.ts'
import { failureReason, stripAnsi } from '../wrangler.ts'
import { migrate } from './migrate.ts'

export const DEPLOY_USAGE = [
  'Usage: hollware deploy [--url <url>]',
  '',
  'Deploys the project to Cloudflare with its wrangler, and applies the migrations to the remote',
  'database. The first deploy creates the D1 database, the KV namespace and the queues that',
  'wrangler.jsonc names without an id, and writes their ids into it: commit them.',
  '',
  'HOLLWARE_PUBLIC_URL must be the public URL of the Worker. While it is a localhost URL, the',
  'workers.dev URL that wrangler prints is written into wrangler.jsonc, and the Worker is deployed',
  'again with it. Run "wrangler login" first.',
  '',
  'Options:',
  '  --url <url>  The public URL of the Worker, such as https://cms.example.com (default: the',
  '               HOLLWARE_PUBLIC_URL of wrangler.jsonc, or the workers.dev URL)',
  '  --help       Show this help',
].join('\n')

/** The workers.dev URL that `wrangler deploy` prints, or `undefined`. */
export function workersDevUrlOf(stdout: string): string | undefined {
  // The host ends at workers.dev: `….workers.dev.evil.example` is another host.
  const match = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev(?![\w.-])/i.exec(
    stripAnsi(stdout),
  )
  return match === null ? undefined : new URL(match[0]).origin
}

/** Whether a URL is this machine's: the one `pnpm dev` serves, which no deploy answers at. */
function isLoopback(url: string): boolean {
  const { hostname } = new URL(url)
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

const PUBLIC_URL_VALUE = /("HOLLWARE_PUBLIC_URL"\s*:\s*)"[^"\n]*"/

/**
 * `wrangler.jsonc` with `HOLLWARE_PUBLIC_URL` set to `url`, and everything else as it was: its
 * comments, its order and its spacing. It changes the one string and nothing around it.
 */
export function withPublicUrl(text: string, url: string): string {
  if (!PUBLIC_URL_VALUE.test(text)) {
    throw new CliError(
      'wrangler.jsonc has no "HOLLWARE_PUBLIC_URL" in "vars". Add it, with the public URL of the Worker.',
    )
  }
  return text.replace(PUBLIC_URL_VALUE, (_match, key: string) => `${key}${JSON.stringify(url)}`)
}

async function wranglerDeploy(io: Io): Promise<string> {
  const deployed = await io.wrangler(['deploy'])
  if (deployed.code !== 0) {
    throw new CliError(
      `wrangler could not deploy: ${failureReason(deployed)}. Is wrangler logged in ("wrangler login")?`,
    )
  }
  return deployed.stdout
}

export async function deploy(argv: readonly string[], io: Io): Promise<number> {
  const { values } = parseFlags({
    args: [...argv],
    allowPositionals: false,
    options: { url: { type: 'string' }, help: { type: 'boolean' } },
  })
  if (values.help === true) {
    io.out(DEPLOY_USAGE)
    return 0
  }
  const file = join(io.cwd, 'wrangler.jsonc')
  if (!existsSync(file)) {
    throw new CliError(`${file} is missing: run hollware deploy in the directory of the project.`)
  }
  const configured = publicUrlOf(io.cwd, undefined)
  const asked = values.url === undefined ? undefined : publicUrlOf(io.cwd, values.url)
  const database = resolveDatabase(io.cwd, undefined)

  io.out('Deploying with wrangler ...')
  const printed = await wranglerDeploy(io)
  let url = asked ?? (configured !== undefined && !isLoopback(configured) ? configured : undefined)
  url ??= workersDevUrlOf(printed)
  if (url === undefined) {
    throw new CliError(
      'wrangler deployed the Worker but printed no workers.dev URL. Run "hollware deploy --url <the public URL of the Worker>".',
    )
  }
  if (url !== configured) {
    writeFileSync(file, withPublicUrl(readFileSync(file, 'utf8'), url))
    io.out(`Set HOLLWARE_PUBLIC_URL to ${url} in wrangler.jsonc. Deploying again with it ...`)
    await wranglerDeploy(io)
  }

  await migrate(['--remote', '--database', database], io)

  const [owners = []] = await query(io.wrangler, database, 'remote', ownerQuery())
  io.out(
    [
      `Hollware is live at ${url}.`,
      '',
      `  MCP    ${url}/mcp`,
      `  Admin  ${url}/admin/`,
      '',
      'Commit wrangler.jsonc: it holds the ids of what the deploy created, and the public URL.',
      ...(owners.length === 0
        ? [
            '',
            'Next: create your site and its owner in the remote database. It prints a token for your',
            'agents and a link to set up your passkey; shape the site in the admin afterwards:',
            '  hollware init --site <key> --remote',
          ]
        : []),
    ].join('\n'),
  )
  return 0
}
