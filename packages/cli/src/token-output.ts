import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { CliError, UsageError } from './errors.ts'
import type { Io } from './io.ts'

export interface TokenFile {
  readonly path: string
  readonly force: boolean
}

export function tokenFileOf(
  io: Io,
  flag: string | undefined,
  force: boolean | undefined,
): TokenFile | undefined {
  if (flag === undefined) {
    if (force === true) throw new UsageError('--force goes with --token-file.')
    return undefined
  }
  if (flag.trim() === '') throw new UsageError('--token-file needs a path.')
  const path = resolve(io.cwd, flag)
  if (!existsSync(dirname(path)) || !statSync(dirname(path)).isDirectory()) {
    throw new CliError(`the directory of --token-file does not exist: ${dirname(path)}.`)
  }
  if (existsSync(path) && force !== true) {
    throw new CliError(
      `${path} exists already, and a token is never written over a file: choose another path, or pass --force to replace it.`,
    )
  }
  return { path, force: force === true }
}

export function writeTokenFile(file: TokenFile, secret: string): void {
  if (file.force) rmSync(file.path, { force: true })
  writeFileSync(file.path, `${secret}\n`, { flag: 'wx', mode: 0o600 })
}

export function deliverToken(
  file: TokenFile | undefined,
  secret: string,
): { token: string } | { tokenFile: string } {
  if (file === undefined) return { token: secret }
  writeTokenFile(file, secret)
  return { tokenFile: file.path }
}
