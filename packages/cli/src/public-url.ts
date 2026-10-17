import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { UsageError } from './errors.ts'
import { parseJsonc } from './jsonc.ts'

/**
 * The public URL of the project's Hollware, for the links the CLI prints: `--url` when given,
 * else `vars.HOLLWARE_PUBLIC_URL` of the project's `wrangler.jsonc`, else `undefined`.
 */
export function publicUrlOf(cwd: string, flag: string | undefined): string | undefined {
  if (flag !== undefined) {
    if (!URL.canParse(flag)) throw new UsageError(`--url is no URL: ${flag}`)
    return new URL(flag).origin
  }
  const file = ['wrangler.jsonc', 'wrangler.json'].map((name) => join(cwd, name)).find(existsSync)
  if (file === undefined) return undefined
  let config: unknown
  try {
    config = parseJsonc(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
  const vars =
    typeof config === 'object' && config !== null && 'vars' in config ? config.vars : undefined
  const url =
    typeof vars === 'object' && vars !== null && 'HOLLWARE_PUBLIC_URL' in vars
      ? vars.HOLLWARE_PUBLIC_URL
      : undefined
  return typeof url === 'string' && URL.canParse(url) ? new URL(url).origin : undefined
}

/** The link that lets a person set up a passkey with an invitation. */
export function setupLink(url: string | undefined, secret: string): string {
  return `${url ?? '<your Hollware URL>'}/setup#invitation=${secret}`
}
