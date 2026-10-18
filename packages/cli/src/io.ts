import type { DevHost } from './dev-host.ts'
import type { RunWrangler } from './wrangler.ts'

/**
 * Everything a command takes from the outside world. `main` gets it as an argument and nothing
 * in this package reads `process`, so a test hands in a fake of each part. The entry point of
 * `index.ts` builds the real one.
 */
export interface Io {
  /** One message for stdout. Whoever owns the stream adds the trailing newline. */
  out: (message: string) => void
  /** One message for stderr. */
  err: (message: string) => void
  /** The directory a command works in: the project of `init`, `migrate` and `token`. Relative paths resolve against it. */
  cwd: string
  /** The current time. */
  now: () => Date
  /** Bytes from a cryptographically secure source, for ids and tokens. */
  randomBytes: (length: number) => Uint8Array
  /** Everything piped into stdin, as text; `undefined` when stdin is a terminal and nothing was piped. */
  readStdin: () => Promise<string | undefined>
  /** Runs the project's wrangler with these arguments. */
  wrangler: RunWrangler
  /** A new empty directory for temporary files. Whoever asks for it removes it. */
  tempDir: () => string
  /** What `hollware dev` needs of the machine: processes, signals and the health check. */
  dev?: DevHost
}
