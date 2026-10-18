import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  'again with it. A URL on a domain of your own (not workers.dev) also gets a route in',
  'wrangler.jsonc that serves the Worker there as a custom domain: Cloudflare makes its DNS record',
  'and its certificate, in a zone of the same account. Run "wrangler login" first.',
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

/** The host of a public URL on a domain of its own: neither this machine nor workers.dev. */
export function customDomainOf(url: string): string | undefined {
  if (isLoopback(url)) return undefined
  const { hostname } = new URL(url)
  return /(?:^|\.)workers\.dev$/i.test(hostname) ? undefined : hostname
}

const ROUTES_KEY = /^\s*"routes"\s*:/m
/** The first key of the starter's wrangler.jsonc, at the top level of the object. */
const TOP_LEVEL_NAME = /^ {2}"name"\s*:\s*"[^"\n]*",[^\n]*\n/m

/**
 * `wrangler.jsonc` with a route that serves the Worker at `host` as a custom domain, after its
 * `name`, and everything else as it was. A config with routes of its own is left as it is.
 */
export function withCustomDomain(text: string, host: string): string {
  if (ROUTES_KEY.test(text)) return text
  if (!TOP_LEVEL_NAME.test(text)) {
    throw new CliError(
      `wrangler.jsonc has no "name" at its top. Add "routes": [{ "pattern": "${host}", "custom_domain": true }] to it.`,
    )
  }
  return text.replace(
    TOP_LEVEL_NAME,
    (line) =>
      `${line}  // The custom domain of the Worker: Cloudflare makes its DNS record and its certificate.\n` +
      `  "routes": [{ "pattern": ${JSON.stringify(host)}, "custom_domain": true }],\n`,
  )
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
  const known =
    asked ?? (configured !== undefined && !isLoopback(configured) ? configured : undefined)
  const domain = known === undefined ? undefined : customDomainOf(known)
  let written = configured
  if (known !== undefined && domain !== undefined) {
    // A domain of its own is known before the first deploy, which then serves it at once.
    const before = readFileSync(file, 'utf8')
    const withUrl = known === configured ? before : withPublicUrl(before, known)
    const after = withCustomDomain(withUrl, domain)
    if (after === withUrl && !withUrl.includes(JSON.stringify(domain))) {
      io.out(
        `wrangler.jsonc has routes of its own and none for ${domain}: add { "pattern": "${domain}", "custom_domain": true } to them.`,
      )
    }
    if (after !== before) {
      writeFileSync(file, after)
      io.out(
        `Serving the Worker at ${domain}: set HOLLWARE_PUBLIC_URL and its route in wrangler.jsonc.`,
      )
    }
    written = known
  }

  io.out('Deploying with wrangler ...')
  const printed = await wranglerDeploy(io)
  const url = known ?? workersDevUrlOf(printed)
  if (url === undefined) {
    throw new CliError(
      'wrangler deployed the Worker but printed no workers.dev URL. Run "hollware deploy --url <the public URL of the Worker>".',
    )
  }
  if (url !== written) {
    writeFileSync(file, withPublicUrl(readFileSync(file, 'utf8'), url))
    io.out(`Set HOLLWARE_PUBLIC_URL to ${url} in wrangler.jsonc. Deploying again with it ...`)
    await wranglerDeploy(io)
  }

  await ensureMasterSecret(io)
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

/** The Worker secret that seals the secrets Hollware makes for the structure (ADR-033). */
export const MASTER_SECRET = 'HOLLWARE_SECRET'

/**
 * Gives the Worker its `HOLLWARE_SECRET` when it has none: 32 random bytes in hex, through a file
 * that only the user may read, deleted at once, so the value is never printed nor kept. One the
 * Worker has is left as it is: a new one would leave the sealed secrets unopenable.
 */
export async function ensureMasterSecret(io: Io): Promise<void> {
  const listed = await io.wrangler(['secret', 'list'])
  if (listed.code !== 0) {
    throw new CliError(
      `wrangler could not list the secrets of the Worker: ${failureReason(listed)}.`,
    )
  }
  if (listed.stdout.includes(`"${MASTER_SECRET}"`)) return
  const value = Array.from(io.randomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
  const directory = io.tempDir()
  try {
    const file = join(directory, 'secrets.json')
    writeFileSync(file, JSON.stringify({ [MASTER_SECRET]: value }), { mode: 0o600 })
    const put = await io.wrangler(['secret', 'bulk', file])
    if (put.code !== 0) {
      throw new CliError(`wrangler could not set ${MASTER_SECRET}: ${failureReason(put)}.`)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  io.out(
    `Made ${MASTER_SECRET}, which seals the secrets Hollware makes, such as those of webhooks.`,
  )
}
