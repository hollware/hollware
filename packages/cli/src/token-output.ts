import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { CliError, UsageError } from './errors.ts'
import type { Io } from './io.ts'

/** Where `--token-file` says a token goes, checked before anything is written to the database. */
export interface TokenFile {
  /** The absolute path. */
  readonly path: string
  /** `--force`: replace a file that exists. */
  readonly force: boolean
}

/**
 * `--token-file` and `--force`, checked: the file must not exist unless `--force` (a token is
 * never written over something else), and its directory must. Called before the database is
 * written, so that a refusal leaves no token that nobody saw.
 */
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

/** Writes the token and a newline to the file, readable by its owner only (mode 0600). */
export function writeTokenFile(file: TokenFile, secret: string): void {
  // Removed first, so that a file that existed keeps neither its mode nor a link it was.
  if (file.force) rmSync(file.path, { force: true })
  writeFileSync(file.path, `${secret}\n`, { flag: 'wx', mode: 0o600 })
}

/**
 * Hands the token over as the person chose: in the file (and the answer holds its path), or in
 * the answer itself. Returns the field for the JSON of a command.
 */
export function deliverToken(
  file: TokenFile | undefined,
  secret: string,
): { token: string } | { tokenFile: string } {
  if (file === undefined) return { token: secret }
  writeTokenFile(file, secret)
  return { tokenFile: file.path }
}
